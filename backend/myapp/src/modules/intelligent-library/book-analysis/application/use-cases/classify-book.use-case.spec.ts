import type { ContentRevision, EpubBookLocatorV1 } from "../../../book-content/domain/book-document.types";
import {
  BookClassificationError,
} from "../classification-response";
import { ClassifyBookUseCase } from "./classify-book.use-case";

const REVISION: ContentRevision = {
  fileChecksum: "sha256:book-v1",
  extractorVersion: "epub-1",
  normalizationVersion: "text-1",
};
const OPTIONS = {
  strategyVersion: "book-profile-v1",
  confidenceThreshold: 0.75,
  maxSchemaRepairAttempts: 2,
  maxSampleSections: 3,
  maxSampleCharacters: 6_000,
  maxCharactersPerSample: 2_000,
};

function structuredClassification(confidence: number, primaryGenre = "technical") {
  return {
    primaryGenre,
    secondaryGenres: ["popular-science"],
    traits: ["线性推进", "示例丰富"],
    confidence,
    classificationSummary: "内容从核心概念逐步推进到实践应用。",
  };
}

function inspectResult(toc = [{ nodeId: "toc-1", label: "Introduction", path: "Introduction" }]) {
  return {
    baseProfileVersion: 3,
    book: {
      bookId: 42,
      title: "Reliable Systems",
      authors: ["A. Reader"],
      description: "A practical guide to building reliable systems.",
      format: "epub" as const,
    },
    contentRevision: REVISION,
    toc,
    contentStats: { sectionCount: 12, tocNodeCount: toc.length, charCount: 120_000 },
  };
}

function locator(sectionIndex: number): EpubBookLocatorV1 {
  return {
    version: 1,
    bookId: 42,
    contentRevision: REVISION,
    position: { kind: "epub_text", sectionIndex, start: 0, end: 120 },
  };
}

function createFixture() {
  const content = {
    inspect: jest.fn().mockResolvedValue(inspectResult()),
    sampleRepresentativeText: jest.fn().mockResolvedValue([
      { text: "bounded first sample", locator: locator(1), chapterPath: "Introduction" },
      { text: "bounded middle sample", locator: locator(6), chapterPath: "Core" },
      { text: "bounded final sample", locator: locator(11), chapterPath: "Conclusion" },
    ]),
  };
  const classifier = { classify: jest.fn() };
  const profiles = { saveProfile: jest.fn() };
  const modelConfigs = {
    getCredential: jest.fn().mockReturnValue({
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
      apiKey: "test-only-key",
    }),
  };
  const now = jest.fn().mockReturnValue("2026-08-08T00:00:00.000Z");
  const idFactory = jest.fn().mockReturnValue("profile-1");
  const useCase = new ClassifyBookUseCase(
    content as never,
    classifier as never,
    profiles as never,
    modelConfigs as never,
    OPTIONS,
    { now, idFactory },
  );
  return { useCase, content, classifier, profiles, modelConfigs };
}

describe("ClassifyBookUseCase", () => {
  it("高置信度首轮分类直接保存画像，不补读正文", async () => {
    const fixture = createFixture();
    fixture.classifier.classify.mockResolvedValue(structuredClassification(0.93));

    const profile = await fixture.useCase.execute({ userId: 7, bookId: 42 });

    expect(fixture.classifier.classify).toHaveBeenCalledTimes(1);
    expect(fixture.content.sampleRepresentativeText).not.toHaveBeenCalled();
    expect(fixture.profiles.saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "profile-1",
        userId: 7,
        bookId: 42,
        confidence: 0.93,
        contentRevision: REVISION,
        modelId: "deepseek-v4-flash",
        strategyVersion: "book-profile-v1",
      }),
      3,
    );
    expect(profile.confidence).toBe(0.93);
  });

  it("低置信度触发一次有界代表性正文采样并用第二轮结果", async () => {
    const fixture = createFixture();
    fixture.classifier.classify
      .mockResolvedValueOnce(structuredClassification(0.54, "general"))
      .mockResolvedValueOnce(structuredClassification(0.87, "technical"));

    const profile = await fixture.useCase.execute({ userId: 7, bookId: 42 });

    expect(fixture.content.sampleRepresentativeText).toHaveBeenCalledWith({
      userId: 7,
      bookId: 42,
      contentRevision: REVISION,
      maxSections: 3,
      maxTotalCharacters: 6_000,
      maxCharactersPerSection: 2_000,
    });
    expect(fixture.classifier.classify).toHaveBeenCalledTimes(2);
    expect(fixture.classifier.classify.mock.calls[1][0]).toMatchObject({
      contentRevision: REVISION,
      samples: [
        { text: "bounded first sample", locator: locator(1) },
        { text: "bounded middle sample", locator: locator(6) },
        { text: "bounded final sample", locator: locator(11) },
      ],
    });
    expect(profile.primaryGenre).toBe("technical");
    expect(profile.confidence).toBe(0.87);
  });

  it("目录缺失时即使首轮置信度较高也补读有界正文", async () => {
    const fixture = createFixture();
    fixture.content.inspect.mockResolvedValue(inspectResult([]));
    fixture.classifier.classify
      .mockResolvedValueOnce(structuredClassification(0.91))
      .mockResolvedValueOnce(structuredClassification(0.92));

    await fixture.useCase.execute({ userId: 7, bookId: 42 });

    expect(fixture.content.sampleRepresentativeText).toHaveBeenCalledTimes(1);
    expect(fixture.classifier.classify).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["非法枚举", { ...structuredClassification(0.9), primaryGenre: "memoir" }],
    ["缺失字段", { primaryGenre: "technical", confidence: 0.9 }],
    ["超范围 confidence", structuredClassification(1.5)],
  ])("模型首次返回%s时携带脱敏 issue 修复并保存合规画像", async (_name, response) => {
    const fixture = createFixture();
    fixture.classifier.classify
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce(structuredClassification(0.91));

    await expect(fixture.useCase.execute({ userId: 7, bookId: 42 })).resolves.toMatchObject({
      confidence: 0.91,
    });
    expect(fixture.classifier.classify).toHaveBeenCalledTimes(2);
    const repairInput = fixture.classifier.classify.mock.calls[1][0] as {
      repair?: { attempt: number; issues: Array<{ path: string; code: string }> };
    };
    expect(repairInput.repair).toMatchObject({
      attempt: 1,
      issues: expect.arrayContaining([
        expect.objectContaining({ path: expect.any(String), code: expect.any(String) }),
      ]),
    });
    expect(JSON.stringify(repairInput.repair)).not.toContain("memoir");
    expect(fixture.profiles.saveProfile).toHaveBeenCalledTimes(1);
  });

  it("同一分析任务耗尽两次 Schema 修复后失败且不保存画像", async () => {
    const fixture = createFixture();
    fixture.classifier.classify.mockResolvedValue({
      primaryGenre: "critical-thinking",
      confidence: 1.5,
      hiddenReasoning: "must-not-be-forwarded",
    });

    await expect(fixture.useCase.execute({ userId: 7, bookId: 42 })).rejects.toMatchObject({
      code: "CLASSIFICATION_SCHEMA_INVALID",
    });
    expect(fixture.classifier.classify).toHaveBeenCalledTimes(3);
    expect(fixture.classifier.classify.mock.calls[1][0]).toMatchObject({ repair: { attempt: 1 } });
    expect(fixture.classifier.classify.mock.calls[2][0]).toMatchObject({ repair: { attempt: 2 } });
    expect(JSON.stringify(fixture.classifier.classify.mock.calls.slice(1))).not.toContain("must-not-be-forwarded");
    expect(fixture.profiles.saveProfile).not.toHaveBeenCalled();
  });

  it("分类 Adapter 抛出 malformed arguments 时也在同一任务内修复", async () => {
    const fixture = createFixture();
    const malformed = new BookClassificationError(
      "CLASSIFICATION_SCHEMA_INVALID",
      "sanitized malformed arguments",
      false,
    ) as BookClassificationError & { issues?: Array<{ path: string; code: string }> };
    malformed.issues = [{ path: "$", code: "invalid_json" }];
    fixture.classifier.classify
      .mockRejectedValueOnce(malformed)
      .mockResolvedValueOnce(structuredClassification(0.92));

    await expect(fixture.useCase.execute({ userId: 7, bookId: 42 })).resolves.toMatchObject({
      confidence: 0.92,
    });
    expect(fixture.classifier.classify.mock.calls[1][0]).toMatchObject({
      repair: {
        attempt: 1,
        issues: [{ path: "$", code: "invalid_json" }],
      },
    });
  });

  it.each([
    ["CLASSIFICATION_REFUSED", false],
    ["CLASSIFICATION_TIMEOUT", true],
  ] as const)("透传稳定模型错误码 %s 且不保存上游内容", async (code, retryable) => {
    const fixture = createFixture();
    fixture.classifier.classify.mockRejectedValue(
      new BookClassificationError(code, "sanitized model failure", retryable),
    );

    await expect(fixture.useCase.execute({ userId: 7, bookId: 42 })).rejects.toMatchObject({
      code,
      retryable,
    });
    expect(fixture.profiles.saveProfile).not.toHaveBeenCalled();
  });
});
