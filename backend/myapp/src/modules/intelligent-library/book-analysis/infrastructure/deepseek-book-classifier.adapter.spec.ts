import type { ContentRevision } from "../../book-content/domain/book-document.types";
import { BOOK_CLASSIFICATION_JSON_SCHEMA } from "../application/ports/book-classifier.port";
import { LanguageModelBookClassifierAdapter } from "./language-model-book-classifier.adapter";

const REVISION: ContentRevision = {
  fileChecksum: "sha256:book-v1",
  extractorVersion: "epub-1",
  normalizationVersion: "text-1",
};

function input() {
  return {
    providerId: "deepseek",
    modelId: "deepseek-v4-flash",
    apiKey: "test-only-key",
    book: {
      bookId: 42,
      title: "Learning to Ask Questions",
      authors: ["A. Reader"],
      description: null,
      format: "epub" as const,
    },
    contentRevision: REVISION,
    toc: [],
    contentStats: { sectionCount: 12, tocNodeCount: 0, charCount: 120_000 },
    responseSchema: BOOK_CLASSIFICATION_JSON_SCHEMA,
  };
}

describe("LanguageModelBookClassifierAdapter", () => {
  it("修复请求只发送脱敏 issue，不发送上一轮原始输出", async () => {
    const model = {
      complete: jest.fn().mockResolvedValue({
        message: {
          toolCalls: [{
            id: "call-1",
            name: "submit_book_classification",
            arguments: JSON.stringify({
              primaryGenre: "argumentation",
              secondaryGenres: [],
              traits: ["问题驱动"],
              confidence: 0.9,
              classificationSummary: "内容围绕评估论点展开，按结构化步骤组织。",
            }),
          }],
        },
      }),
    };
    const adapter = new LanguageModelBookClassifierAdapter(model as never);

    await adapter.classify({
      ...input(),
      repair: {
        attempt: 1,
        issues: [{ path: "primaryGenre", code: "invalid_value" }],
      },
    } as never);

    const request = model.complete.mock.calls[0][0];
    const userMessage = request.messages.find((message: { role: string }) => message.role === "user");
    expect(JSON.parse(userMessage.content)).toMatchObject({
      repair: {
        attempt: 1,
        issues: [{ path: "primaryGenre", code: "invalid_value" }],
      },
    });
    expect(userMessage.content).not.toContain("previousOutput");
    expect(request.messages[0].content).toContain("完整新对象");
  });

  it("非法 Tool arguments 返回可用于修复的脱敏 issue", async () => {
    const model = {
      complete: jest.fn().mockResolvedValue({
        message: {
          toolCalls: [{
            id: "call-1",
            name: "submit_book_classification",
            arguments: "{not-json secret-content",
          }],
        },
      }),
    };
    const adapter = new LanguageModelBookClassifierAdapter(model as never);

    await expect(adapter.classify(input() as never)).rejects.toMatchObject({
      code: "CLASSIFICATION_SCHEMA_INVALID",
      issues: [{ path: "$", code: "invalid_json" }],
    });
  });

  it("未知内部异常直接传播，不伪装成可重试的 provider 故障", async () => {
    const defect = new Error("request builder defect");
    const adapter = new LanguageModelBookClassifierAdapter({
      complete: jest.fn().mockRejectedValue(defect),
    } as never);

    await expect(adapter.classify(input() as never)).rejects.toBe(defect);
  });
});
