export const BOOK_ANALYSIS_STRATEGY_VERSION = "book-profile-v1";

export const BOOK_ANALYSIS_CLASSIFICATION_OPTIONS = {
  strategyVersion: BOOK_ANALYSIS_STRATEGY_VERSION,
  confidenceThreshold: 0.75,
  maxSchemaRepairAttempts: 2,
  maxSampleSections: 3,
  maxSampleCharacters: 6_000,
  maxCharactersPerSample: 2_000,
} as const;
