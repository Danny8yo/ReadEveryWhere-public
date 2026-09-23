import { BookReadingProfileAccessService } from "./book-reading-profile-access.service";

const REVISION = {
  fileChecksum: "sha256:current",
  extractorVersion: "epub-extractor-v4",
  normalizationVersion: "epub-text-v1",
};

describe("BookReadingProfileAccessService", () => {
  it("never exposes an unconfirmed candidate as an AI Reading profile", async () => {
    const store = {
      getSnapshot: jest.fn().mockReturnValue({
        status: "ready",
        stale: false,
        profile: { id: "candidate-1", primaryGenre: "technical" },
        candidate: { id: "candidate-1", primaryGenre: "technical" },
        errorCode: null,
      }),
    };
    const service = new BookReadingProfileAccessService(
      { getCurrentProfile: jest.fn().mockReturnValue({ status: "not_analyzed", profile: null }) },
      { findOwnedAnalysisSource: jest.fn().mockReturnValue({
        userId: 7,
        bookId: 42,
        fileName: "book.epub",
        mimeType: "application/epub+zip",
        downloadStatus: "completed",
      }) },
      { currentRevision: jest.fn().mockResolvedValue(REVISION) },
      store as never,
      "book-profile-v1",
    );

    await expect(service.getCurrentProfile(7, 42)).resolves.toEqual({
      status: "ready",
      stale: false,
      profile: null,
      errorCode: null,
    });
  });

  it("returns the configured formal profile without consulting candidate state", async () => {
    const profile = {
      profileId: "profile-1",
      primaryGenre: "argumentation",
      secondaryGenres: [],
      traits: [],
      confidence: { kind: "user-determined" as const },
      classificationSummary: null,
      profileVersion: 2,
      updatedAt: "2026-08-27T01:00:00.000Z",
    };
    const store = { getSnapshot: jest.fn() };
    const service = new BookReadingProfileAccessService(
      { getCurrentProfile: jest.fn().mockReturnValue({ status: "ready", profile }) },
      { findOwnedAnalysisSource: jest.fn() },
      { currentRevision: jest.fn() },
      store as never,
      "book-profile-v1",
    );

    await expect(service.getCurrentProfile(7, 42)).resolves.toEqual({
      status: "ready",
      stale: false,
      profile,
      errorCode: null,
    });
    expect(store.getSnapshot).not.toHaveBeenCalled();
  });

  it("fails when the formal profile adapter violates the ready/profile invariant", async () => {
    const service = new BookReadingProfileAccessService(
      { getCurrentProfile: jest.fn().mockReturnValue({ status: "ready", profile: null }) },
      { findOwnedAnalysisSource: jest.fn() },
      { currentRevision: jest.fn() },
      { getSnapshot: jest.fn() } as never,
      "book-profile-v1",
    );

    await expect(service.getCurrentProfile(7, 42))
      .rejects.toThrow("Formal reading profile status is ready but profile is missing");
  });
});
