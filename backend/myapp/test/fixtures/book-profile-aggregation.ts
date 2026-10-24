import type { BookReadingProfileCandidateJSON } from "../../src/modules/intelligent-library/book-analysis/domain/book-reading-profile-candidate";

export const LEGACY_PROFILE_REVISION = {
  fileChecksum: "sha256:current",
  extractorVersion: "epub-extractor-v4",
  normalizationVersion: "epub-text-v1",
} as const;

export const LEGACY_STALE_PROFILE_REVISION = {
  ...LEGACY_PROFILE_REVISION,
  fileChecksum: "sha256:stale",
} as const;

export const LEGACY_MULTI_PROFILE_FIXTURE: BookReadingProfileCandidateJSON[] = [
  {
    id: "profile-stale",
    userId: 7,
    bookId: 42,
    primaryGenre: "general",
    secondaryGenres: [],
    traits: ["stale"],
    confidence: 0.5,
    classificationSummary: "A stale profile from an earlier content revision.",
    contentRevision: LEGACY_STALE_PROFILE_REVISION,
    modelId: "deepseek-v4-flash",
    strategyVersion: "book-profile-v1",
    analyzedAt: "2026-08-27T00:00:00.000Z",
  },
  {
    id: "profile-current-older",
    userId: 7,
    bookId: 42,
    primaryGenre: "technical",
    secondaryGenres: [],
    traits: ["linear"],
    confidence: 0.8,
    classificationSummary: "The older valid profile.",
    contentRevision: LEGACY_PROFILE_REVISION,
    modelId: "deepseek-v4-flash",
    strategyVersion: "book-profile-v1",
    analyzedAt: "2026-08-27T01:00:00.000Z",
  },
  {
    id: "profile-current-latest",
    userId: 7,
    bookId: 42,
    primaryGenre: "argumentation",
    secondaryGenres: ["popular-science"],
    traits: ["claim-driven", "evidence-heavy"],
    confidence: 0.93,
    classificationSummary: "The latest valid profile.",
    contentRevision: LEGACY_PROFILE_REVISION,
    modelId: "deepseek-v4-flash",
    strategyVersion: "book-profile-v1",
    analyzedAt: "2026-08-27T02:00:00.000Z",
  },
];
