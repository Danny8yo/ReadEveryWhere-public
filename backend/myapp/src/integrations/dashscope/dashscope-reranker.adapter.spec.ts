import { RerankerError } from "../../support/ai-model/public";
import { DashScopeRerankerAdapter } from "./dashscope-reranker.adapter";
import { rerankerSettings } from "./dashscope-integration.module";

const config = { url: "https://example.test/rerank", model: "qwen-rerank", apiKey: "sk-secret-value" };
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const input = (extra: Partial<{ timeoutMs: number; signal: AbortSignal }> = {}) =>
  ({ query: "临时表", documents: ["甲", "乙", "丙"], timeoutMs: 1000, signal: new AbortController().signal, ...extra });
async function failure(promise: Promise<unknown>) {
  try { await promise; } catch (error) { return error as RerankerError; }
  throw new Error("expected rejection");
}
describe("DashScope reranker adapter", () => {
  it("D1/D7 maps index-addressed scores back to input order and reports usage", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(ok({ request_id: "r1", usage: { total_tokens: 80 },
      output: { results: [{ index: 2, relevance_score: 0.9 }, { index: 0, relevance_score: 0.5 }, { index: 1, relevance_score: 0.1 }] } }));
    const result = await new DashScopeRerankerAdapter(fetchImpl, config).rank(input());
    expect(result).toEqual({ scores: [0.5, 0.1, 0.9], usage: { requests: 1, totalTokens: 80 }, requestId: "r1" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(config.url);
    expect(JSON.parse(init.body)).toEqual({ model: "qwen-rerank", input: { query: "临时表", documents: ["甲", "乙", "丙"] },
      parameters: { return_documents: false, top_n: 3 } });
    expect(init.headers.Authorization).toBe("Bearer sk-secret-value");
  });
  it("D7 missing token usage is null, never zero", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(ok({ output: { results: [0, 1, 2].map(index => ({ index, relevance_score: 1 })) } }));
    expect((await new DashScopeRerankerAdapter(fetchImpl, config).rank(input())).usage.totalTokens).toBeNull();
  });
  it.each([
    ["too few results", { output: { results: [{ index: 0, relevance_score: 1 }] } }],
    ["duplicate index", { output: { results: [0, 0, 1].map(index => ({ index, relevance_score: 1 })) } }],
    ["NaN-like score", { output: { results: [{ index: 0, relevance_score: "x" }, { index: 1, relevance_score: 1 }, { index: 2, relevance_score: 1 }] } }],
    ["index out of range", { output: { results: [0, 1, 3].map(index => ({ index, relevance_score: 1 })) } }],
  ])("D2 rejects %s as a protocol failure", async (_name, body) => {
    const error = await failure(new DashScopeRerankerAdapter(jest.fn().mockResolvedValue(ok(body)), config).rank(input()));
    expect(error).toBeInstanceOf(RerankerError);
    expect(error.kind).toBe("protocol");
  });
  it("D3 HTTP errors are http failures and D9 account quota codes are quota failures", async () => {
    const http = await failure(new DashScopeRerankerAdapter(jest.fn().mockResolvedValue(ok({ code: "InternalError" }, 500)), config).rank(input()));
    expect([http.kind, http.status]).toEqual(["http", 500]);
    for (const code of ["Arrearage", "Throttling.AllocationQuota"]) {
      const quota = await failure(new DashScopeRerankerAdapter(jest.fn().mockResolvedValue(ok({ code }, 400)), config).rank(input()));
      expect(quota.kind).toBe("quota");
    }
  });
  it("D10 a request slower than its budget is a timeout; D4 caller cancellation is cancelled", async () => {
    const hang = jest.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) =>
      init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true }))) as unknown as typeof fetch;
    expect((await failure(new DashScopeRerankerAdapter(hang, config).rank(input({ timeoutMs: 20 })))).kind).toBe("timeout");
    const controller = new AbortController();
    const pending = new DashScopeRerankerAdapter(hang, config).rank(input({ signal: controller.signal, timeoutMs: 5000 }));
    controller.abort(new Error("stop"));
    expect((await failure(pending)).kind).toBe("cancelled");
  });
  it("D8 error messages never contain the API key", async () => {
    const error = await failure(new DashScopeRerankerAdapter(jest.fn().mockRejectedValue(new Error("socket hang up")), config).rank(input()));
    expect(error.message).not.toContain(config.apiKey);
    expect(JSON.stringify(error)).not.toContain(config.apiKey);
  });
  it("makes exactly one request per call (no hidden retry)", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(ok({ code: "InternalError" }, 503));
    await failure(new DashScopeRerankerAdapter(fetchImpl, config).rank(input()));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("configuration is explicit: off, or dashscope with every variable present", () => {
    expect(rerankerSettings({})).toEqual({ enabled: false });
    expect(rerankerSettings({ SELECTION_QA_RERANKER: "" })).toEqual({ enabled: false });
    expect(() => rerankerSettings({ SELECTION_QA_RERANKER: "other" })).toThrow("off or dashscope");
    expect(() => rerankerSettings({ SELECTION_QA_RERANKER: "dashscope", DASHSCOPE_RERANK_URL: config.url })).toThrow("requires");
    const on = rerankerSettings({ SELECTION_QA_RERANKER: "dashscope", DASHSCOPE_RERANK_URL: config.url, DASHSCOPE_RERANK_MODEL: "m", DASHSCOPE_RERANK_API_KEY: "k" });
    expect(on.enabled && on.reranker.identity).toEqual({ provider: "dashscope", model: "m" });
  });
});
