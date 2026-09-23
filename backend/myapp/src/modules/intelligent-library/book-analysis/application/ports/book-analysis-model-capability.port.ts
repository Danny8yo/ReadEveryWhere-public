import type { BookAnalysisModelCredential } from "./book-analysis-model-config.port";

export interface BookAnalysisModelCapabilityPort {
  supportsStrictTools(credential: Readonly<BookAnalysisModelCredential>): boolean;
}

export const BOOK_ANALYSIS_MODEL_CAPABILITY_PORT = Symbol(
  "INTELLIGENT_LIBRARY_BOOK_ANALYSIS_MODEL_CAPABILITY_PORT",
);
