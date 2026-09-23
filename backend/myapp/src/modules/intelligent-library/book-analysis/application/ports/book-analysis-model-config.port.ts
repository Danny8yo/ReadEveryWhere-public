export interface BookAnalysisModelCredential {
  provider: string;
  modelId: string;
  apiKey: string;
}

export interface BookAnalysisModelConfigPort {
  getCredential(userId: number): BookAnalysisModelCredential | null;
}

export const BOOK_ANALYSIS_MODEL_CONFIG_PORT = Symbol(
  "INTELLIGENT_LIBRARY_BOOK_ANALYSIS_MODEL_CONFIG_PORT",
);
