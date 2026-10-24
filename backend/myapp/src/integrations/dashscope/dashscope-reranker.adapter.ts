import { RerankerError, type RerankerIdentity, type RerankerPort } from "../../support/ai-model/public";

export interface DashScopeRerankConfig { url: string; model: string; apiKey: string }
type Fetch = typeof fetch;
// Account-level failures: retrying cannot help and an operator must act.
const QUOTA_CODES = /Arrearage|AllocationQuota|FreeTierOnly|InsufficientBalance|QuotaExhausted/i;
/** Alibaba Cloud Model Studio (DashScope) text-rerank. One request per call; no hidden retry. */
export class DashScopeRerankerAdapter implements RerankerPort {
  readonly identity: RerankerIdentity;
  constructor(private readonly fetchImpl: Fetch, private readonly config: DashScopeRerankConfig) {
    if (!/^https:\/\//.test(config.url) || !config.model.trim() || !config.apiKey.trim())
      throw new Error("DashScope reranker requires an https URL, a model and an API key");
    this.identity = { provider: "dashscope", model: config.model };
  }
  async rank(input: Parameters<RerankerPort["rank"]>[0]) {
    if (!input.query.trim() || !input.documents.length || input.documents.some(d => !d))
      throw new RerankerError("protocol", "Rerank requires a query and non-empty documents");
    if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs <= 0) throw new RerankerError("timeout", "Rerank deadline already passed");
    if (input.signal.aborted) throw new RerankerError("cancelled", "Rerank cancelled before request");
    const timeout = AbortSignal.timeout(input.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(this.config.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.config.model,
          input: { query: input.query, documents: input.documents },
          parameters: { return_documents: false, top_n: input.documents.length },
        }),
        signal: AbortSignal.any([input.signal, timeout]),
      });
    } catch (error) {
      if (input.signal.aborted) throw new RerankerError("cancelled", "Rerank cancelled");
      if (timeout.aborted) throw new RerankerError("timeout", `Rerank exceeded ${input.timeoutMs}ms`);
      throw new RerankerError("http", `Rerank request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    let body: unknown;
    try { body = await response.json(); } catch {
      if (input.signal.aborted) throw new RerankerError("cancelled", "Rerank cancelled");
      if (timeout.aborted) throw new RerankerError("timeout", `Rerank exceeded ${input.timeoutMs}ms`);
      throw new RerankerError(response.ok ? "protocol" : "http", `Rerank returned non-JSON HTTP ${response.status}`, response.status);
    }
    const record = (body ?? {}) as { code?: unknown; message?: unknown; request_id?: unknown; output?: { results?: unknown }; usage?: { total_tokens?: unknown } };
    if (!response.ok) {
      const code = typeof record.code === "string" ? record.code : "";
      throw new RerankerError(QUOTA_CODES.test(code) ? "quota" : "http",
        `Rerank HTTP ${response.status}${code ? ` ${code}` : ""}`, response.status);
    }
    const results = record.output?.results;
    const n = input.documents.length;
    if (!Array.isArray(results) || results.length !== n)
      throw new RerankerError("protocol", `Rerank returned ${Array.isArray(results) ? results.length : "no"} results for ${n} documents`);
    const scores = new Array<number>(n).fill(Number.NaN);
    for (const item of results as Array<{ index?: unknown; relevance_score?: unknown }>) {
      const index = item.index, score = item.relevance_score;
      if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= n || !Number.isNaN(scores[index as number]) ||
          typeof score !== "number" || !Number.isFinite(score))
        throw new RerankerError("protocol", "Rerank result has an invalid, duplicate or non-finite entry");
      scores[index as number] = score;
    }
    const tokens = record.usage?.total_tokens;
    return {
      scores,
      usage: { requests: 1, totalTokens: Number.isSafeInteger(tokens) ? tokens as number : null },
      requestId: typeof record.request_id === "string" ? record.request_id : null,
    };
  }
}
