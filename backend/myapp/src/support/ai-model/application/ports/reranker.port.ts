/** Provider-neutral text reranking. Scores are only comparable within one call. */
export interface RerankerIdentity { provider: string; model: string }
export interface RerankerUsage { requests: number; totalTokens: number | null }
export interface RerankerPort {
  readonly identity: RerankerIdentity;
  rank(input: { query: string; documents: string[]; timeoutMs: number; signal: AbortSignal }):
    Promise<{ scores: number[]; usage: RerankerUsage; requestId: string | null }>;
}
/** Failure classes callers must distinguish; quota failures need operator attention, not retries. */
export type RerankerFailureKind = "timeout" | "http" | "protocol" | "quota" | "cancelled";
export class RerankerError extends Error {
  constructor(readonly kind: RerankerFailureKind, message: string, readonly status: number | null = null) {
    super(message);
    this.name = "RerankerError";
  }
}
/** Explicit deployment state: absence of a reranker is a configuration, never a runtime default. */
export type RerankerSettings = { enabled: false } | { enabled: true; reranker: RerankerPort };
export const RERANKER_SETTINGS = Symbol("RERANKER_SETTINGS");
