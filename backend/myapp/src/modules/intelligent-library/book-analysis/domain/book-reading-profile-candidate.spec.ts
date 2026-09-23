import {
  BOOK_READING_GENRES,
  BookAnalysisDomainError,
  BookReadingProfileCandidate,
} from "./book-reading-profile-candidate";

const NOW = "2026-08-08T00:00:00.000Z";
const REVISION = {
  fileChecksum: "sha256:book-v1",
  extractorVersion: "epub-1",
  normalizationVersion: "text-1",
};

function createProfile(overrides: Record<string, unknown> = {}) {
  return BookReadingProfileCandidate.create({
    id: "profile-1",
    userId: 7,
    bookId: 42,
    primaryGenre: "technical",
    secondaryGenres: ["popular-science"],
    traits: ["linear", "example-heavy"],
    confidence: 0.91,
    classificationSummary: "The contents progress from concepts to implementation.",
    contentRevision: REVISION,
    modelId: "deepseek-v4-flash",
    strategyVersion: "book-profile-v1",
    analyzedAt: NOW,
    ...overrides,
  });
}

describe("BookReadingProfileCandidate", () => {
  it("只接受 V1 约定的八种书籍类型", () => {
    expect(BOOK_READING_GENRES).toEqual([
      "technical",
      "argumentation",
      "narrative",
      "paper",
      "poetry",
      "popular-science",
      "self-help",
      "general",
    ]);

    for (const primaryGenre of BOOK_READING_GENRES) {
      expect(createProfile({ primaryGenre, secondaryGenres: [] }).primaryGenre).toBe(primaryGenre);
    }
    expect(() => createProfile({ primaryGenre: "biography" })).toThrow(
      expect.objectContaining({ code: "PROFILE_GENRE_INVALID" }),
    );
  });

  it.each([-0.01, 1.01, Number.NaN])("拒绝超出 0..1 的置信度 %p", (confidence) => {
    expect(() => createProfile({ confidence })).toThrow(
      expect.objectContaining({ code: "PROFILE_CONFIDENCE_INVALID" }),
    );
  });

  it("拒绝缺失或不完整的 content revision", () => {
    expect(() => createProfile({ contentRevision: null })).toThrow(
      expect.objectContaining({ code: "PROFILE_REVISION_INVALID" }),
    );
    expect(() => createProfile({
      contentRevision: { ...REVISION, fileChecksum: "" },
    })).toThrow(
      expect.objectContaining({ code: "PROFILE_REVISION_INVALID" }),
    );
  });

  it("规范化 secondaryGenres 和 traits，但不允许主类型重复出现在次类型中", () => {
    const profile = createProfile({
      secondaryGenres: ["general", "popular-science", "general"],
      traits: ["  linear  ", "example-heavy", "linear"],
    });

    expect(profile.secondaryGenres).toEqual(["general", "popular-science"]);
    expect(profile.traits).toEqual(["linear", "example-heavy"]);
    expect(() => createProfile({ secondaryGenres: ["technical"] })).toThrow(
      expect.objectContaining({ code: "PROFILE_GENRE_INVALID" }),
    );
  });

  it("仅在内容 revision 与策略版本同时匹配时判定 ready", () => {
    const profile = createProfile();

    expect(profile.validityFor(REVISION, "book-profile-v1")).toBe("ready");
    expect(profile.validityFor(
      { ...REVISION, fileChecksum: "sha256:book-v2" },
      "book-profile-v1",
    )).toBe("stale");
    expect(profile.validityFor(REVISION, "book-profile-v2")).toBe("stale");
  });

  it("快照不可被调用方修改，且不包含隐藏思维链字段", () => {
    const profile = createProfile();
    const json = profile.toJSON();
    json.traits.push("mutated");
    json.contentRevision.fileChecksum = "sha256:mutated";

    expect(profile.toJSON()).toMatchObject({
      traits: ["linear", "example-heavy"],
      contentRevision: REVISION,
      classificationSummary: "The contents progress from concepts to implementation.",
    });
    expect(profile.toJSON()).not.toHaveProperty("reasoning");
    expect(profile.toJSON()).not.toHaveProperty("chainOfThought");
  });
});
