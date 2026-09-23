import { AppException } from "../../../../platform/http/app-exception";
import { CatalogBookReadingProfileAdapter } from "./catalog-book-reading-profile.adapter";

describe("CatalogBookReadingProfileAdapter", () => {
  it("projects a configured manual profile without inventing AI provenance", () => {
    const adapter = new CatalogBookReadingProfileAdapter({
      getBook: jest.fn().mockReturnValue({
        readingProfile: {
          id: "profile-1",
          primaryGenre: "argumentation",
          secondaryGenres: ["popular-science"],
          traits: ["claim-driven"],
          confidence: { kind: "user-determined" },
          classificationSummary: null,
          profileVersion: 4,
          updatedAt: "2026-08-27T01:00:00.000Z",
        },
      }),
    });

    expect(adapter.getCurrentProfile(7, 42)).toEqual({
      status: "ready",
      profile: {
        profileId: "profile-1",
        primaryGenre: "argumentation",
        secondaryGenres: ["popular-science"],
        traits: ["claim-driven"],
        confidence: { kind: "user-determined" },
        classificationSummary: null,
        profileVersion: 4,
        updatedAt: "2026-08-27T01:00:00.000Z",
      },
    });
  });

  it("treats the aggregate's empty profile as not configured", () => {
    const adapter = new CatalogBookReadingProfileAdapter({
      getBook: jest.fn().mockReturnValue({
        readingProfile: {
          id: "profile-1",
          primaryGenre: null,
          secondaryGenres: [],
          traits: [],
          confidence: null,
          classificationSummary: null,
          profileVersion: 1,
          updatedAt: "2026-08-27T01:00:00.000Z",
        },
      }),
    });

    expect(adapter.getCurrentProfile(7, 42)).toEqual({
      status: "not_analyzed",
      profile: null,
    });
  });

  it("preserves the existing ownership-safe not-found error", () => {
    const adapter = new CatalogBookReadingProfileAdapter({
      getBook: jest.fn().mockReturnValue(null),
    });

    expect(() => adapter.getCurrentProfile(7, 42)).toThrow(AppException);
    try {
      adapter.getCurrentProfile(7, 42);
    } catch (error) {
      expect(error).toMatchObject({
        status: 404,
        code: 40401,
        details: { field: "bookId", reason: "BOOK_NOT_FOUND" },
      });
    }
  });
});
