export interface BookAnalysisSummarySource {
  id: number;
  userId: number;
  fileName: string | null;
  mimeType: string | null;
  checksum: string | null;
}

export interface BookAnalysisSummary {
  status: "pending" | "running" | "ready" | "failed" | "stale" | "unsupported";
  primaryGenre: string | null;
  displayLabel: string | null;
  confidence: number | null;
  analyzedAt: string | null;
  stale: boolean;
  candidateId?: string | null;
}

export interface BookAnalysisSummaryQueryPort {
  project(book: BookAnalysisSummarySource): BookAnalysisSummary | null;
}

export const BOOK_ANALYSIS_SUMMARY_QUERY_PORT = Symbol(
  "INTELLIGENT_LIBRARY_BOOK_ANALYSIS_SUMMARY_QUERY_PORT",
);
