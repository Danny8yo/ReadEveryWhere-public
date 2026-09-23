import {
  BOOK_READING_GENRES,
  BookProfileDomainError,
  BookReadingProfile,
} from "./book-reading-profile";

const NOW = "2026-08-27T00:00:00.000Z";

describe("Catalog BookReadingProfile entity", () => {
  it("creates the canonical empty profile without a fake genre", () => {
    const profile = BookReadingProfile.empty({ id: "profile-1", now: NOW });

    expect(profile.toJSON()).toEqual({
      id: "profile-1",
      primaryGenre: null,
      secondaryGenres: [],
      traits: [],
      confidence: null,
      classificationSummary: null,
      profileVersion: 1,
      updatedAt: NOW,
    });
    expect(profile.isConfigured()).toBe(false);
    expect(BOOK_READING_GENRES).toContain("general");
  });

  it("creates a pure manual profile with user-determined confidence and no traits", () => {
    const profile = BookReadingProfile.empty({ id: "profile-1", now: NOW });

    expect(profile.editByUser({
      primaryGenre: "technical",
      secondaryGenres: ["popular-science"],
      classificationSummary: "  适合按概念与实践阅读  ",
    }, "2026-08-27T01:00:00.000Z")).toBe(true);

    expect(profile.toJSON()).toMatchObject({
      primaryGenre: "technical",
      secondaryGenres: ["popular-science"],
      traits: [],
      confidence: { kind: "user-determined" },
      classificationSummary: "适合按概念与实践阅读",
      profileVersion: 2,
    });
    expect(profile.isConfigured()).toBe(true);
  });

  it("user edits preserve AI traits but replace AI score and never retain an omitted AI summary", () => {
    const profile = aiProfile();

    expect(profile.editByUser({ secondaryGenres: ["self-help"] }, "2026-08-27T02:00:00.000Z"))
      .toBe(true);
    expect(profile.toJSON()).toMatchObject({
      primaryGenre: "technical",
      secondaryGenres: ["self-help"],
      traits: ["claim-driven", "evidence-heavy"],
      confidence: { kind: "user-determined" },
      classificationSummary: null,
      profileVersion: 4,
    });
  });

  it("editing only the reason is a user determination and allows clearing it", () => {
    const profile = aiProfile();

    expect(profile.editByUser({ classificationSummary: null }, "2026-08-27T02:00:00.000Z"))
      .toBe(true);
    expect(profile.toJSON()).toMatchObject({
      confidence: { kind: "user-determined" },
      classificationSummary: null,
      traits: ["claim-driven", "evidence-heavy"],
      profileVersion: 4,
    });
  });

  it("increments only for a real profile change", () => {
    const profile = BookReadingProfile.rehydrate({
      id: "profile-1",
      primaryGenre: "technical",
      secondaryGenres: [],
      traits: [],
      confidence: { kind: "user-determined" },
      classificationSummary: null,
      profileVersion: 2,
      updatedAt: NOW,
    });

    expect(profile.editByUser({ primaryGenre: "technical" }, NOW)).toBe(false);
    expect(profile.profileVersion).toBe(2);
  });

  it("enforces genre, secondary and bounded text invariants", () => {
    const profile = BookReadingProfile.empty({ id: "profile-1", now: NOW });

    expect(() => profile.editByUser({ secondaryGenres: ["technical"] }, NOW))
      .toThrow(expect.objectContaining({ code: "PROFILE_PRIMARY_GENRE_REQUIRED" }));
    expect(() => profile.editByUser({
      primaryGenre: "technical",
      secondaryGenres: ["technical"],
    }, NOW)).toThrow(expect.objectContaining({ code: "PROFILE_GENRE_INVALID" }));
    expect(() => profile.editByUser({
      primaryGenre: "technical",
      classificationSummary: "x".repeat(501),
    }, NOW)).toThrow(expect.objectContaining({ code: "PROFILE_SUMMARY_INVALID" }));
    expect(() => BookReadingProfile.rehydrate({
      ...aiProfile().toJSON(),
      confidence: { kind: "ai-score", score: 1.1 },
    })).toThrow(BookProfileDomainError);
  });

  it("clears to canonical empty state while preserving identity", () => {
    const profile = aiProfile();

    expect(profile.clear("2026-08-27T03:00:00.000Z")).toBe(true);
    expect(profile.toJSON()).toEqual({
      id: "profile-ai",
      primaryGenre: null,
      secondaryGenres: [],
      traits: [],
      confidence: null,
      classificationSummary: null,
      profileVersion: 4,
      updatedAt: "2026-08-27T03:00:00.000Z",
    });
    expect(profile.clear("2026-08-27T04:00:00.000Z")).toBe(false);
  });
});

function aiProfile(): BookReadingProfile {
  return BookReadingProfile.rehydrate({
    id: "profile-ai",
    primaryGenre: "technical",
    secondaryGenres: ["popular-science"],
    traits: ["claim-driven", "evidence-heavy"],
    confidence: { kind: "ai-score", score: 0.91 },
    classificationSummary: "AI generated reason.",
    profileVersion: 3,
    updatedAt: NOW,
  });
}
