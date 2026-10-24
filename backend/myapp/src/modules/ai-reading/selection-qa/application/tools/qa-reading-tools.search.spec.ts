import { createHash } from "node:crypto";
import { QaEvidenceLedger } from "../qa-evidence";
import { QA_SEARCH } from "../selection-qa-query-policy";
import { QaRerankError, type QaBookPort, type QaClaim, type QaEvidence, type QaPoolCandidate, type QaRerankerPort, type QaRuntimeStore, type QaSearchMode } from "../selection-qa-runtime.port";
import { createQaReadingTools } from "./qa-reading-tools";
import type { QaRegisteredTool } from "./qa-tool-registry";

const scope = { bookId: 1, fileChecksum: "sha256:x", extractorVersion: "e", normalizationVersion: "n", sectionIndex: 0, href: "c.xhtml" };
const claim = {
  turn: { id: "t1", userId: 1, question: "临时表在什么情况下产生？", deadline: Date.now() + 600_000 },
  conversation: { bookId: 1, selection: { scope, artifact: { bookId: 1, artifactId: "a", fileChecksum: "sha256:x" }, start: 0, end: 2, canonicalQuote: "原文" } },
} as unknown as QaClaim;
const quoteAt = (n: number, length = 100) => `第${n}段`.padEnd(length, "文");
const candidate = (n: number, length = 100): QaPoolCandidate => {
  const quote = quoteAt(n, length);
  return { sectionIndex: 0, href: "c.xhtml", start: n * 1000, end: n * 1000 + quote.length, quote,
    quoteHash: createHash("sha256").update(quote).digest("hex"), displayedQuote: quote, cfi: `epubcfi(/6/2!/4/${n})`,
    fusedRank: n, paths: [{ kind: "word_query", query: "临时表", rank: n }] };
};
const evidenceOf = (c: Pick<QaPoolCandidate, "start" | "end" | "quote" | "sectionIndex" | "href" | "cfi">): QaEvidence => ({
  locator: { version: 1, bookId: 1, contentRevision: { fileChecksum: "sha256:x", extractorVersion: "e", normalizationVersion: "n" },
    position: { kind: "epub_text", sectionIndex: c.sectionIndex, start: c.start, end: c.end } },
  quote: c.quote, quoteHash: createHash("sha256").update(c.quote).digest("hex"), displayedQuote: c.quote,
  sectionIndex: c.sectionIndex, href: c.href, start: c.start, end: c.end, cfi: c.cfi,
});
function setup(mode: QaSearchMode, pool: QaPoolCandidate[], chars = 500000) {
  const store = { charged: 0, phase: jest.fn(), evidence: jest.fn(),
    remaining: () => ({ models: 40, tools: 60, chars: chars - store.charged }),
    chargeRead: (_c: QaClaim, n: number) => { store.charged += n; } };
  const books = {
    index: jest.fn(async () => ({ state: "ready" as const })),
    searchCandidates: jest.fn(async () => ({ state: "ready" as const, candidates: pool.slice(0, 20).map(evidenceOf), unavailable: [], budgetLimited: false, contextTruncated: false })),
    searchPool: jest.fn(async () => ({ state: "ready" as const, candidates: pool, unavailable: [], lists: [{ kind: "word_query" }],
      pipeline: { tokenizerVersion: "rew-dual-v1:x", queryPolicyVersion: "dual-rrf-v1" } })),
    verifyCandidates: jest.fn(async (_u: number, _s: unknown, input: { candidates: QaPoolCandidate[]; limit: number; maxChars: number }) => {
      const admitted: number[] = []; let left = input.maxChars, budgetLimited = false;
      input.candidates.forEach((c, i) => { if (admitted.length >= input.limit) return; if (c.quote.length > left) { budgetLimited = true; return; } admitted.push(i); left -= c.quote.length; });
      return { candidates: admitted.map(i => evidenceOf(input.candidates[i])), admitted, budgetLimited };
    }),
    expandSelected: jest.fn(async (_u: number, _s: unknown, input: { evidence: QaEvidence[] }) => {
      const candidates = input.evidence.map(e => evidenceOf({ ...e, start: e.start - 1, quote: "前" + e.quote }));
      return { candidates, contextTruncated: false, contextWindows: candidates.map(e => ({ sectionIndex: 0, start: e.start, end: e.end, hitRanges: [] })) };
    }),
    context: jest.fn(), replay: jest.fn(),
  } as unknown as jest.Mocked<QaBookPort>;
  const ledger = new QaEvidenceLedger(claim, store as unknown as QaRuntimeStore);
  const tools = createQaReadingTools({ claim, store: store as unknown as QaRuntimeStore, books, ledger, currentBook: { bookId: 1, title: "书" },
    history: { research: [], turns: [], historicalEvidence: [] }, searchOutcome: { succeeded: 0, failed: 0 } }, mode);
  const tool = (name: string) => tools.find(t => t.definition().function.name === name) as QaRegisteredTool;
  const signal = new AbortController().signal;
  const search = () => tool("search_book").execute({ informationNeed: "临时表产生的场景", queries: { query1: "临时表", query2: "", query3: "", query4: "" } }, signal, Date.now() + 30_000);
  return { store, books, ledger, tools, tool, search, signal };
}
const reranker = (scores: (docs: string[]) => number[] | Promise<number[]>): jest.Mocked<QaRerankerPort> => ({
  identity: { provider: "dashscope", model: "rerank-test" },
  rank: jest.fn(async ({ documents }) => ({ scores: await scores(documents), usage: { requests: 1, totalTokens: 123 }, requestId: "r" })),
});
const pool30 = Array.from({ length: 30 }, (_, n) => candidate(n));
// Reverse fused order: the reranker prefers later candidates.
const reverse = (docs: string[]) => docs.map((_d, i) => i);

describe("search_book with reranking", () => {
  it("E1 the model sees only the reranked top K within the page budget, with pool metadata", async () => {
    const r = reranker(reverse);
    const { search, books } = setup({ reranker: r, screening: "llm" }, pool30);
    const result = await search();
    const data = result.modelObservation as Record<string, any>;
    expect(data.resultCount).toBe(QA_SEARCH.topK);
    expect(data.searchId).toBe("search-1");
    expect(data.poolSize).toBe(30);
    expect(data.poolRemaining).toBe(30 - QA_SEARCH.topK);
    expect(data.ranking).toEqual({ status: "reranked" });
    expect(data.delivery).toBe("reranked_candidates");
    expect(books.verifyCandidates.mock.calls[0][2].maxChars).toBe(QA_SEARCH.rerankedMaxChars);
    const delivered = (result.data as any).deliveredRanks.map((d: any) => d.fusedRank);
    expect(delivered).toEqual([29, 28, 27, 26, 25, 24]);
    expect(r.rank.mock.calls[0][0].query).toBe("临时表产生的场景\n临时表在什么情况下产生？");
    expect(r.rank.mock.calls[0][0].documents).toHaveLength(30);
    expect(books.searchCandidates).not.toHaveBeenCalled();
  });
  it("E2/E3 more_search_results pages through the same pool without repeats and rejects unknown ids", async () => {
    const { search, tool, signal } = setup({ reranker: reranker(reverse), screening: "llm" }, pool30);
    await search();
    const more = tool("more_search_results");
    const seen = new Set<number>();
    let remaining = 30 - QA_SEARCH.topK;
    while (remaining > 0) {
      const page = await more.execute({ searchId: "search-1" }, signal, Date.now() + 30_000);
      for (const d of (page.data as any).deliveredRanks) { expect(seen.has(d.fusedRank)).toBe(false); seen.add(d.fusedRank); }
      remaining = (page.data as any).poolRemaining;
    }
    expect(seen.size).toBe(30 - QA_SEARCH.topK);
    const exhausted = await more.execute({ searchId: "search-1" }, signal, Date.now() + 30_000);
    expect(exhausted.observationStatus).toBe("empty");
    await expect(more.execute({ searchId: "search-9" }, signal, Date.now() + 30_000)).rejects.toMatchObject({ code: "TOOL_ARGUMENTS_INVALID" });
  });
  it("E4 a tight read budget admits whole passages in rank order and reports budgetLimited", async () => {
    const { search } = setup({ reranker: reranker(reverse), screening: "llm" }, [candidate(0, 300), candidate(1, 50), candidate(2, 300)], 400);
    const result = await search();
    expect((result.data as any).deliveredRanks.map((d: any) => d.fusedRank)).toEqual([2, 1]);
    expect((result.modelObservation as any).budgetLimited).toBe(true);
  });
  it("E8/E9 screening=none expands the reranked top K and registers only the expansions", async () => {
    const { search, books, ledger } = setup({ reranker: reranker(reverse), screening: "none" }, pool30);
    const result = await search();
    expect(books.expandSelected).toHaveBeenCalledTimes(1);
    expect(books.expandSelected.mock.calls[0][2]).toMatchObject({ maxChars: QA_SEARCH.expandMaxChars, maxWindowChars: QA_SEARCH.expandWindowChars });
    expect((result.modelObservation as any).delivery).toBe("reranked_expanded");
    expect([...ledger.items.values()].every(e => e.quote.startsWith("前"))).toBe(true);
    expect(ledger.items.size).toBe(QA_SEARCH.topK);
  });
  it.each([
    ["timeout", new QaRerankError("timeout", "slow")],
    ["protocol", new QaRerankError("protocol", "bad")],
    ["quota", new QaRerankError("quota", "Arrearage")],
  ])("D3/D9/E10 a %s failure falls back to the lexical top 20 for LLM screening, marked explicitly", async (kind, error) => {
    const r = reranker(() => { throw error; });
    const { search, books } = setup({ reranker: r, screening: "none" }, pool30);
    const result = await search();
    const model = result.modelObservation as any;
    expect(model.ranking).toEqual({ status: "fallback_llm_screening", reason: kind });
    expect(model.delivery).toBe("lexical_candidates");
    expect(model.resultCount).toBe(QA_SEARCH.fallbackLimit);
    expect(model.instruction).toMatch(/not semantically ranked/);
    expect(books.verifyCandidates.mock.calls[0][2]).toMatchObject({ limit: QA_SEARCH.fallbackLimit, maxChars: QA_SEARCH.fallbackMaxChars });
    expect(books.expandSelected).not.toHaveBeenCalled();
    expect((result.data as any).deliveredRanks.map((d: any) => d.fusedRank)).toEqual(Array.from({ length: 20 }, (_, n) => n));
    expect(r.rank).toHaveBeenCalledTimes(1);
  });
  it("D2 a score count mismatch is a protocol failure handled by the same fallback", async () => {
    const { search } = setup({ reranker: reranker(docs => docs.slice(1).map(() => 1)), screening: "llm" }, pool30);
    expect(((await search()).modelObservation as any).ranking).toEqual({ status: "fallback_llm_screening", reason: "protocol" });
  });
  it("E11 two searches in one turn record their own ranking status", async () => {
    let calls = 0;
    const { search } = setup({ reranker: reranker(docs => { if (calls++ === 1) throw new QaRerankError("http", "503"); return docs.map(() => 1); }), screening: "llm" }, pool30);
    const first = await search(), second = await search();
    expect([(first.data as any).searchId, (first.data as any).ranking.status]).toEqual(["search-1", "reranked"]);
    expect([(second.data as any).searchId, (second.data as any).ranking.status]).toEqual(["search-2", "fallback_llm_screening"]);
  });
  it("D6/E6 an empty pool skips the reranker; events carry pipeline, lists, ranking identity and usage", async () => {
    const empty = setup({ reranker: reranker(reverse), screening: "llm" }, []);
    const nothing = await empty.search();
    expect(nothing.observationStatus).toBe("empty");
    const r = reranker(reverse);
    const { search } = setup({ reranker: r, screening: "llm" }, pool30);
    const data = (await search()).data as any;
    expect(data.pipeline).toEqual({ tokenizerVersion: "rew-dual-v1:x", queryPolicyVersion: "dual-rrf-v1" });
    expect(data.lists).toEqual([{ kind: "word_query" }]);
    expect(data.ranking).toMatchObject({ status: "reranked", provider: "dashscope", model: "rerank-test", usage: { requests: 1, totalTokens: 123 } });
    expect(data.deliveredRanks[0]).toMatchObject({ rerankRank: 0, paths: [{ kind: "word_query" }] });
    expect(data.deliveredChars).toBeGreaterThan(0);
  });
  it("D4 turn cancellation during reranking propagates instead of falling back", async () => {
    const controller = new AbortController();
    const r = reranker(() => new Promise(() => undefined));
    const { tool, books } = setup({ reranker: r, screening: "llm" }, pool30);
    const pending = tool("search_book").execute({ informationNeed: "x", queries: { query1: "临时表", query2: "", query3: "", query4: "" } }, controller.signal, Date.now() + 30_000);
    await new Promise(resolve => setImmediate(resolve));
    controller.abort("CANCELLED");
    await expect(pending).rejects.toBeTruthy();
    expect(books.verifyCandidates).not.toHaveBeenCalled();
  });
  it("repeat guard: two identical reranked searches produce the same progress fact", async () => {
    const { search } = setup({ reranker: reranker(reverse), screening: "llm" }, pool30);
    const first = await search(), second = await search();
    expect((first.data as any).searchId).not.toBe((second.data as any).searchId);
    expect(second.progress).toBe(first.progress);
  });
  it("screening=none widens the window for a soft-capped chunk longer than the default so its hit stays whole", async () => {
    const { search, books } = setup({ reranker: reranker(reverse), screening: "none" }, [candidate(1, 2000)]);
    await search();
    expect(books.expandSelected.mock.calls[0][2]).toMatchObject({ maxWindowChars: 2000 });
  });
  it("an empty pool says so instead of suggesting paging; the fallback names the paging tool", async () => {
    const empty = (await setup({ reranker: reranker(reverse), screening: "llm" }, []).search()).modelObservation as any;
    expect(empty.delivery).toBe("empty_pool");
    expect(empty.instruction).not.toContain("more_search_results");
    const fallback = (await setup({ reranker: reranker(() => { throw new QaRerankError("http", "503"); }), screening: "llm" }, pool30).search()).modelObservation as any;
    expect(fallback.instruction).toContain("more_search_results");
  });
  it("without a reranker the previous top-20 LLM screening path is unchanged and has no paging tool", async () => {
    const { search, books, tools } = setup({ reranker: null, screening: "llm" }, pool30);
    const result = await search();
    expect(result.modelObservation).toMatchObject({ resultCount: 20 });
    expect(books.searchCandidates.mock.calls[0][2]).toMatchObject({ limit: 20, maxChars: 12000, informationNeed: "临时表产生的场景" });
    expect(books.searchPool).not.toHaveBeenCalled();
    expect(tools.map(t => t.definition().function.name)).not.toContain("more_search_results");
  });
});
