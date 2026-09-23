import {
  BookClassificationError,
  parseBookClassificationResponse,
} from "./classification-response";

const VALID = {
  primaryGenre: "argumentation",
  secondaryGenres: ["popular-science"],
  traits: ["论点驱动", "证据充分"],
  confidence: 0.88,
  classificationSummary: "各章节围绕核心论点展开，并通过证据进行检验。",
};

describe("parseBookClassificationResponse", () => {
  it("接受且仅返回严格结构化分类字段", () => {
    expect(parseBookClassificationResponse(VALID)).toEqual(VALID);
  });

  it.each([
    ["非法枚举", { ...VALID, primaryGenre: "memoir" }],
    ["缺失字段", { ...VALID, traits: undefined }],
    ["置信度越界", { ...VALID, confidence: 1.2 }],
    ["未知字段", { ...VALID, hiddenReasoning: "private deliberation" }],
    ["任意模型文本", JSON.stringify(VALID)],
    ["拒绝文本", "I cannot classify this book"],
  ])("拒绝%s", (_name, response) => {
    expect(() => parseBookClassificationResponse(response)).toThrow(
      expect.objectContaining({
        code: "CLASSIFICATION_SCHEMA_INVALID",
      }),
    );
  });

  it("限制 classificationSummary 为简洁依据", () => {
    expect(() => parseBookClassificationResponse({
      ...VALID,
      classificationSummary: "x".repeat(501),
    })).toThrow(
      expect.objectContaining({
        code: "CLASSIFICATION_SCHEMA_INVALID",
      }),
    );
  });

  it("拒绝缺少中文结构特征或分类理由", () => {
    expect(() => parseBookClassificationResponse({
      ...VALID,
      traits: [],
    })).toThrow(expect.objectContaining({ code: "CLASSIFICATION_SCHEMA_INVALID" }));
    expect(() => parseBookClassificationResponse({
      ...VALID,
      classificationSummary: "A structured argument.",
    })).toThrow(expect.objectContaining({ code: "CLASSIFICATION_SCHEMA_INVALID" }));
  });

  it("Schema 错误只暴露脱敏字段路径和错误类型", () => {
    const invalid = {
      ...VALID,
      primaryGenre: "sensitive-invalid-genre",
      hiddenReasoning: "must-not-leak",
    };

    try {
      parseBookClassificationResponse(invalid);
      throw new Error("expected classification validation to fail");
    } catch (error) {
      const failure = error as BookClassificationError & {
        issues?: Array<{ path: string; code: string }>;
      };
      expect(failure.code).toBe("CLASSIFICATION_SCHEMA_INVALID");
      expect(failure.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: "primaryGenre" }),
        expect.objectContaining({ path: "$" }),
      ]));
      expect(JSON.stringify(failure.issues)).not.toContain("sensitive-invalid-genre");
      expect(JSON.stringify(failure.issues)).not.toContain("must-not-leak");
    }
  });
});
