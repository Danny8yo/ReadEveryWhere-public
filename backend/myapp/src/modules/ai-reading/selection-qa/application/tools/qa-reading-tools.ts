import { QaRerankError, type QaBookPort, type QaClaim, type QaCurrentBook, type QaEvidence, type QaPoolCandidate, type QaRuntimeStore, type QaSearchMode, type QaTool } from "../selection-qa-runtime.port";
import { QaEvidenceLedger, qaEvidenceResult } from "../qa-evidence";
import { SelectionQaError } from "../selection-qa.types";
import { QA_QUERY_POLICY_VERSION, QA_SEARCH, rerankQuery, validateSearchArguments } from "../selection-qa-query-policy";
import { qaAwait } from "../runtime/qa-await";
import { qaIds, qaKeys, type QaRegisteredTool, type QaToolResult } from "./qa-tool-registry";

export interface QaReadingEnvironment {
  claim: QaClaim;
  store: QaRuntimeStore;
  books: QaBookPort;
  currentBook: QaCurrentBook;
  ledger: QaEvidenceLedger;
  history: ReturnType<QaRuntimeStore["history"]>;
  searchOutcome: { succeeded: number; failed: number };
}
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) =>
  ({ type: "object", properties, required, additionalProperties: false });
function definition(name: string, description: string, parameters: Record<string, unknown>): QaTool {
  return { type: "function", function: { name, description, parameters, strict: true } };
}
const idsSchema = { type: "array", minItems: 1, maxItems: 12, items: { type: "string", minLength: 1, maxLength: 80 } };

/** Keep every result fact, with its text supplied once in VERIFIED_EVIDENCE. */
export function qaReadingObservation(results: Array<ReturnType<typeof qaEvidenceResult>>, data: Record<string, unknown>) {
  return { ...data, results: results.map(({ text: _text, ...result }) => ({
    ...result, textReference: "VERIFIED_EVIDENCE",
  })) };
}

/** One frozen candidate pool per search call, alive only for this worker claim. */
interface QaSearchPool {
  remaining: Array<{ candidate: QaPoolCandidate; score: number | null; rerankRank: number | null }>;
  reranked: boolean;
  poolSize: number;
  base: Record<string, unknown>;
}
const MORE_TOOL = "more_search_results";
export function createQaReadingTools(env: QaReadingEnvironment, mode: QaSearchMode = { reranker: null, screening: "llm" }): QaRegisteredTool[] {
  const { claim, store, books, ledger, currentBook, history, searchOutcome } = env;
  const selection = claim.conversation.selection;
  const remaining = () => store.remaining(claim).chars;
  const save = (items: QaEvidence[], maxChars: number, from?: string[]) => {
    const chars = items.reduce((n, e) => n + e.quote.length, 0);
    if (chars > maxChars) throw new SelectionQaError("EVIDENCE_INVALID");
    // Validation is completed before charging/publishing the observation.
    items.forEach(e => ledger.validate(e));
    store.chargeRead(claim, chars);
    const saved = items.map((e, i) => ledger.save(e, from?.[i]));
    return saved.map(e => qaEvidenceResult(e, currentBook));
  };
  const observed = (results: ReturnType<typeof save>, data: Record<string, unknown> = {}): QaToolResult => ({
    observationStatus: results.length ? "success" : "empty",
    data: { sourceBook: currentBook, resultCount: results.length, results, ...data },
    modelObservation: qaReadingObservation(results, { sourceBook: currentBook, resultCount: results.length, ...data }),
    progress: JSON.stringify({ ids: results.map(e => e.evidenceId), unavailable: data.unavailable,
      contextTruncated: data.contextTruncated, budgetLimited: data.budgetLimited }),
  });
  const unavailable = (reason: string): QaToolResult => ({
    observationStatus: "not_executed", data: { reason, sourceBook: currentBook },
    // A shared index can become ready without a new query. This reading-specific
    // distinction must not be encoded as an index branch in the generic loop.
    ...(reason === "INDEX_NOT_READY" ? {} : { progress: reason }),
  });
  const searchProperties = {
    informationNeed: { type: "string", minLength: 1, maxLength: 200 },
    queries: object(Object.fromEntries([1, 2, 3, 4].map(n => [`query${n}`, {
      type: "string", minLength: n === 1 ? 1 : 0, maxLength: 128,
      description: "Complete lexical phrases separated by spaces (OR); empty string for unused alternatives. Maximum 16 phrases.",
    }]))),
  };
  const pools = new Map<string, QaSearchPool>();
  let searchCount = 0;
  /** Verifies the next page of a pool; with screening=none the page is expanded and only expansions become evidence. */
  const deliver = async (searchId: string, pool: QaSearchPool, signal: AbortSignal, deadline: number): Promise<QaToolResult> => {
    const autoExpand = pool.reranked && mode.screening === "none";
    const pageLimit = pool.reranked ? QA_SEARCH.topK : QA_SEARCH.fallbackLimit;
    const cap = !pool.reranked ? QA_SEARCH.fallbackMaxChars : autoExpand ? QA_SEARCH.expandMaxChars : QA_SEARCH.rerankedMaxChars;
    const maxChars = Math.min(cap, remaining());
    if (maxChars < 1) return unavailable("READ_BUDGET_EXHAUSTED");
    const page = pool.remaining;
    const verified = page.length
      ? await qaAwait(() => books.verifyCandidates(claim.turn.userId, selection, { candidates: page.map(p => p.candidate), limit: pageLimit, maxChars, deadline, signal }), signal)
      : { candidates: [], admitted: [], budgetLimited: false };
    if (verified.candidates.length !== verified.admitted.length || verified.candidates.length > pageLimit) throw new SelectionQaError("EVIDENCE_INVALID");
    const delivered = verified.admitted.map(index => page[index]);
    pool.remaining = page.filter((_item, index) => !verified.admitted.includes(index));
    let results: ReturnType<typeof save>, contextTruncated = false;
    if (autoExpand && verified.candidates.length) {
      // Soft-capped chunks can exceed the usual window; each window must still contain its whole hit.
      const maxWindowChars = Math.max(QA_SEARCH.expandWindowChars, ...verified.candidates.map(e => e.quote.length));
      const expanded = await qaAwait(() => books.expandSelected(claim.turn.userId, selection, {
        evidence: verified.candidates, maxChars, maxWindowChars, deadline, signal,
      }), signal);
      if (expanded.candidates.length !== verified.candidates.length) throw new SelectionQaError("EVIDENCE_INVALID");
      expanded.candidates.forEach((e, i) => {
        const source = verified.candidates[i];
        if (e.sectionIndex !== source.sectionIndex || e.start > source.start || e.end < source.end ||
            e.quote.slice(source.start - e.start, source.end - e.start) !== source.quote)
          throw new SelectionQaError("EVIDENCE_INVALID");
      });
      contextTruncated = expanded.contextTruncated;
      results = save(expanded.candidates, maxChars);
    } else results = save(verified.candidates, maxChars);
    const ranking = pool.base.ranking as Record<string, unknown>;
    const modelData = {
      ...pool.base, ranking: { status: ranking.status, ...(ranking.reason ? { reason: ranking.reason } : {}) },
      searchId, poolSize: pool.poolSize, poolRemaining: pool.remaining.length,
      delivery: pool.poolSize === 0 ? "empty_pool" : autoExpand ? "reranked_expanded" : pool.reranked ? "reranked_candidates" : "lexical_candidates",
      instruction: pool.poolSize === 0
        ? "The search found no candidate passages. Search with different terms; this does not prove the book lacks the topic."
        : !pool.reranked
        ? `Reranking was unavailable: these passages are in lexical order and were not semantically ranked. Judge relevance yourself; use ${MORE_TOOL} with this searchId for the remaining lexical candidates.`
        : autoExpand
          ? `Passages were ranked by a reranker and expanded with surrounding text. Use ${MORE_TOOL} with this searchId for further ranked passages, or search with new terms.`
          : `Passages were ranked by a reranker. Use ${MORE_TOOL} with this searchId for further ranked passages, or search with new terms.`,
      budgetLimited: verified.budgetLimited, contextTruncated,
    };
    const eventData = { ...modelData, ranking, deliveredRanks: delivered.map(d => ({ fusedRank: d.candidate.fusedRank, rerankRank: d.rerankRank, score: d.score, paths: d.candidate.paths })),
      deliveredChars: results.reduce((n, e) => n + e.text.length, 0) };
    return {
      observationStatus: results.length ? "success" : "empty",
      data: { sourceBook: currentBook, resultCount: results.length, results, ...eventData },
      modelObservation: qaReadingObservation(results, { sourceBook: currentBook, resultCount: results.length, ...modelData }),
      // No searchId here: an identical repeated search must produce an identical observation for the repeat guard.
      progress: JSON.stringify({ ids: results.map(e => e.evidenceId), unavailable: pool.base.unavailable, budgetLimited: verified.budgetLimited }),
    };
  };
  const search = (repeat: boolean): QaRegisteredTool => ({
    kind: "reading", operation: "search_book",
    definition: () => definition(repeat ? "repeat_book_search" : "search_book",
      "Search CURRENT_BOOK only. Inspect returned passages and gaps before choosing another action. Queries may be changed or repeated within the resource budget; an empty search never proves whole-book absence." + (repeat ? " State the new lead or reason for repeating a prior query." : ""),
      object(repeat ? { ...searchProperties, reason: { type: "string", minLength: 1, maxLength: 200 } } : searchProperties)),
    fingerprint: args => JSON.stringify([...validateSearchArguments(args)].sort()),
    onRecoverableError: () => { searchOutcome.failed++; },
    details: args => ({ informationNeed: args.informationNeed, queries: validateSearchArguments(args),
      ...(repeat ? { repeatReason: args.reason } : {}), queryPolicyVersion: QA_QUERY_POLICY_VERSION }),
    execute: async (args, signal, deadline) => {
      qaKeys(args, repeat ? ["informationNeed", "queries", "reason"] : ["informationNeed", "queries"]);
      if (repeat && (typeof args.reason !== "string" || !args.reason.trim() || args.reason.length > 200))
        throw new SelectionQaError("TOOL_ARGUMENTS_INVALID", 409, { field: "reason", constraint: "1-200 characters" });
      const queries = validateSearchArguments(args);
      const informationNeed = String(args.informationNeed);
      const maxChars = Math.min(QA_SEARCH.fallbackMaxChars, remaining());
      if (maxChars < 1) return unavailable("READ_BUDGET_EXHAUSTED");
      const index = await qaAwait(() => books.index(claim.turn.userId, selection), signal);
      if (index.state !== "ready" && index.state !== "building") throw new SelectionQaError("INDEX_STATE_INVALID");
      if (index.state === "building") store.phase(claim, "index_wait", { generation: index.generation });
      if (!mode.reranker) {
        const result = await qaAwait(() => books.searchCandidates(claim.turn.userId, selection, { queries, informationNeed, limit: QA_SEARCH.fallbackLimit, maxChars, deadline, signal }), signal);
        if (result.state === "building") return unavailable("INDEX_NOT_READY");
        if (result.state !== "ready" || result.candidates.length > QA_SEARCH.fallbackLimit) throw new SelectionQaError("EVIDENCE_INVALID");
        searchOutcome.succeeded++;
        return observed(save(result.candidates, maxChars), {
          informationNeed, queries, queryPolicyVersion: QA_QUERY_POLICY_VERSION,
          unavailable: result.unavailable, budgetLimited: result.budgetLimited, contextTruncated: result.contextTruncated,
        });
      }
      const reranker = mode.reranker;
      const pooled = await qaAwait(() => books.searchPool(claim.turn.userId, selection, { queries, informationNeed, poolLimit: QA_SEARCH.poolLimit, deadline, signal }), signal);
      if (pooled.state === "building") return unavailable("INDEX_NOT_READY");
      if (pooled.state !== "ready" || pooled.candidates.length > QA_SEARCH.poolLimit) throw new SelectionQaError("EVIDENCE_INVALID");
      searchOutcome.succeeded++;
      const searchId = `search-${++searchCount}`;
      const base = { informationNeed, queries, queryPolicyVersion: QA_QUERY_POLICY_VERSION, pipeline: pooled.pipeline,
        unavailable: pooled.unavailable, lists: pooled.lists };
      let pool: QaSearchPool;
      if (!pooled.candidates.length) {
        pool = { remaining: [], reranked: true, poolSize: 0, base: { ...base, ranking: { status: "empty_pool" } } };
      } else {
        const query = rerankQuery(informationNeed, claim.turn.question);
        const startedAt = Date.now();
        try {
          const ranked = await qaAwait(() => reranker.rank({ query: query.text, documents: pooled.candidates.map(c => c.quote),
            timeoutMs: Math.max(1, Math.min(QA_SEARCH.rerankTimeoutMs, deadline - Date.now())), signal }), signal);
          if (ranked.scores.length !== pooled.candidates.length || ranked.scores.some(x => !Number.isFinite(x)))
            throw new QaRerankError("protocol", "Reranker score count differs from the pool");
          const order = pooled.candidates.map((candidate, i) => ({ candidate, score: ranked.scores[i] }))
            .sort((a, b) => b.score - a.score || a.candidate.fusedRank - b.candidate.fusedRank)
            .map((item, rerankRank) => ({ ...item, rerankRank }));
          pool = { remaining: order, reranked: true, poolSize: order.length, base: { ...base, ranking: {
            status: "reranked", provider: reranker.identity.provider, model: reranker.identity.model, latencyMs: Date.now() - startedAt,
            usage: ranked.usage, requestId: ranked.requestId, queryTruncated: query.truncated, screening: mode.screening,
          } } };
        } catch (error) {
          if (signal.aborted || !(error instanceof QaRerankError) || error.kind === "cancelled") throw error;
          // Explicit fallback: the unranked lexical pool goes to LLM screening, as before reranking existed.
          pool = { remaining: pooled.candidates.map(candidate => ({ candidate, score: null, rerankRank: null })), reranked: false,
            poolSize: pooled.candidates.length, base: { ...base, ranking: {
              status: "fallback_llm_screening", reason: error.kind, message: error.message,
              provider: reranker.identity.provider, model: reranker.identity.model, latencyMs: Date.now() - startedAt,
            } } };
        }
      }
      pools.set(searchId, pool);
      return deliver(searchId, pool, signal, deadline);
    },
  });
  const searchMore: QaRegisteredTool = {
    kind: "reading", operation: "search_more",
    definition: () => definition(MORE_TOOL,
      "Return the next passages from an earlier search in this turn, in the same ranked order, without searching again. An exhausted pool returns no passages; search with new terms instead.",
      object({ searchId: { type: "string", minLength: 1, maxLength: 40 } })),
    // The remaining size makes each further page a distinct action rather than a repeat.
    fingerprint: args => JSON.stringify([args.searchId, pools.get(String(args.searchId))?.remaining.length ?? null]),
    execute: async (args, signal, deadline) => {
      qaKeys(args, ["searchId"]);
      const searchId = String(args.searchId);
      const pool = pools.get(searchId);
      if (!pool) throw new SelectionQaError("TOOL_ARGUMENTS_INVALID", 409, { field: "searchId", constraint: "searchId returned by a search in this turn" });
      return deliver(searchId, pool, signal, deadline);
    },
  };
  return [search(false), search(true), ...(mode.reranker ? [searchMore] : []), {
    kind: "reading", operation: "selection_context",
    definition: () => definition("read_selection_context", "Read and verify the original selection and nearby text for quotation or book-specific explanation. Does not automatically read history or force an answer next.", object({})),
    fingerprint: () => "selection",
    execute: async (args, signal, deadline) => {
      qaKeys(args, []);
      const maxChars = Math.min(Math.max(4000, selection.end - selection.start), remaining());
      if (maxChars < selection.end - selection.start) return unavailable("READ_BUDGET_EXHAUSTED");
      const item = await qaAwait(() => books.context(claim.turn.userId, selection, {
        sectionIndex: selection.scope.sectionIndex, href: selection.scope.href, start: selection.start, end: selection.end,
        maxChars, deadline, signal,
      }), signal);
      if (item.sectionIndex !== selection.scope.sectionIndex || item.href !== selection.scope.href || item.start > selection.start || item.end < selection.end ||
          item.quote.slice(selection.start - item.start, selection.end - item.start) !== selection.canonicalQuote)
        throw new SelectionQaError("EVIDENCE_INVALID");
      return observed(save([item], maxChars), { contextTruncated: item.contextTruncated === true });
    },
  }, {
    kind: "reading", operation: "history_context",
    definition: () => definition("read_history_evidence", "Revalidate selected recently cited historical passages in CURRENT_BOOK. Historical answers themselves are conversation context, never source evidence. Use IDs from historicalEvidenceAvailable; the new verified IDs can support this answer.", object({ evidenceIds: { ...idsSchema, maxItems: 5 } })),
    fingerprint: args => JSON.stringify(args),
    execute: async (args, signal, deadline) => {
      qaKeys(args, ["evidenceIds"]);
      const ids = qaIds(args.evidenceIds, 5);
      const sources = ids.map(id => {
        const found = history.historicalEvidence.find(e => e.evidenceId === id);
        if (!found) throw new SelectionQaError("EVIDENCE_INVALID");
        return found;
      });
      const maxChars = sources.reduce((n, e) => n + e.quote.length, 0);
      if (maxChars > remaining()) return unavailable("READ_BUDGET_EXHAUSTED");
      const replayed = await qaAwait(() => books.replay(claim.turn.userId, selection, sources, deadline, signal), signal);
      if (replayed.length !== sources.length || replayed.some((e, i) =>
        e.quote !== sources[i].quote || e.quoteHash !== sources[i].quoteHash ||
        JSON.stringify(e.locator) !== JSON.stringify(sources[i].locator))) throw new SelectionQaError("EVIDENCE_INVALID");
      return observed(save(replayed, maxChars, sources.map(e => e.turnId)));
    },
  }, {
    kind: "reading", operation: "evidence_expansion",
    definition: () => definition("expand_evidence", "Expand selected verified passages to inspect surrounding qualifications or missing context. The new text is an observation: inspect it and decide whether to search, read again, clarify, or answer. Original evidence remains an immutable source fact.", object({ evidenceIds: idsSchema, maxWindowChars: { type: "integer", minimum: 1, maximum: 8000 } })),
    fingerprint: args => JSON.stringify(args),
    execute: async (args, signal, deadline) => {
      qaKeys(args, ["evidenceIds", "maxWindowChars"]);
      const sources = qaIds(args.evidenceIds, 12).map(id => ledger.require(id));
      if (!Number.isSafeInteger(args.maxWindowChars) || Number(args.maxWindowChars) < 1 || Number(args.maxWindowChars) > 8000)
        throw new SelectionQaError("TOOL_ARGUMENTS_INVALID", 409, { field: "maxWindowChars", constraint: "integer 1-8000" });
      if (sources.some(e => e.quote.length > Number(args.maxWindowChars)))
        throw new SelectionQaError("TOOL_ARGUMENTS_INVALID", 409, { field: "maxWindowChars", constraint: "must contain every original passage" });
      const maxChars = Math.min(10000, remaining());
      if (sources.reduce((n, e) => n + e.quote.length, 0) > maxChars) return unavailable("READ_BUDGET_EXHAUSTED");
      const expanded = await qaAwait(() => books.expandSelected(claim.turn.userId, selection, {
        evidence: sources, maxChars, maxWindowChars: Number(args.maxWindowChars), deadline, signal,
      }), signal);
      if (expanded.candidates.length !== sources.length || expanded.contextWindows.length !== sources.length)
        throw new SelectionQaError("EVIDENCE_INVALID");
      expanded.candidates.forEach((e, i) => {
        const source = sources[i], window = expanded.contextWindows[i];
        if (e.sectionIndex !== source.sectionIndex || e.start > source.start || e.end < source.end || e.quote.length > Number(args.maxWindowChars) ||
            e.quote.slice(source.start - e.start, source.end - e.start) !== source.quote ||
            window.sectionIndex !== e.sectionIndex || window.start !== e.start || window.end !== e.end ||
            !window.hitRanges.some(hit => hit.sectionIndex === source.sectionIndex && hit.start === source.start && hit.end === source.end))
          throw new SelectionQaError("EVIDENCE_INVALID");
      });
      const results = save(expanded.candidates, maxChars).map((e, i) => ({ ...e, sourceEvidenceId: sources[i].evidenceId }));
      return observed(results, { contextTruncated: expanded.contextTruncated });
    },
  }];
}
