import type { TrustedBookAnalysisContext } from "../../domain";

export const AI_READING_BOOK_ANALYSIS_PORT = Symbol("AI_READING_BOOK_ANALYSIS_PORT");

export type BookAnalysisStatus =
  | "not_analyzed"
  | "pending"
  | "running"
  | "ready"
  | "failed"
  | "stale"
  | "unsupported";

export interface BookAnalysisAccessResult {
  status: BookAnalysisStatus;
  stale: boolean;
  profile: Omit<
    TrustedBookAnalysisContext,
    "contentRevision" | "spoilerPolicy" | "modelId" | "strategyVersion" | "analyzedAt"
  > | null;
  errorCode: string | null;
}

export interface BookAnalysisPort {
  getAccess(userId: number, bookId: number): Promise<BookAnalysisAccessResult>;
}
