import { passingQualityFixture } from "../selection-qa-decision.fixture";
import { createHash } from "node:crypto";
import { SelectionQaExecutor } from "../selection-qa.executor";
import { SelectionQaError, type SelectionSnapshot } from "../selection-qa.types";
import { QA_POLICY, type QaBookPort, type QaClaim, type QaEvidence, type QaModelInput, type QaModelPort, type QaRuntimeStore, type QaToolCall } from "../selection-qa-runtime.port";
import { createQaReadingTools } from "../tools/qa-reading-tools";
import { createQaDeliveryTools } from "../tools/qa-delivery-tools";
import { QaToolRegistry } from "../tools/qa-tool-registry";

const usage = { promptTokens: 10, completionTokens: 10, totalTokens: 20 };
const selection: SelectionSnapshot = {
  scope: { bookId: 1, fileChecksum: "checksum", extractorVersion: "v1", normalizationVersion: "v1", sectionIndex: 0, href: "one.xhtml" },
  artifact: { bookId: 1, artifactId: "artifact", fileChecksum: "checksum" },
  source: { start: { path: [0], offset: 0 }, end: { path: [0], offset: 4 } },
  canonicalQuote: "text", displayedQuote: "text", start: 0, end: 4,
};
function passage(quote: string, start = 0): QaEvidence {
  return { quote, displayedQuote: quote, quoteHash: createHash("sha256").update(quote).digest("hex"), sectionIndex: 0,
    href: "one.xhtml", start, end: start + quote.length, cfi: `cfi-${start}-${quote.length}`,
    locator: { version: 1, bookId: 1, contentRevision: { fileChecksum: "checksum", extractorVersion: "v1", normalizationVersion: "v1" },
      position: { kind: "epub_text", sectionIndex: 0, start, end: start + quote.length } } };
}
const call = (name: string, args: unknown): QaToolCall => ({ id: name, name, arguments: JSON.stringify(args) });
const search = (query: string) => call("search_book", { informationNeed: "核对当前书", queries: { query1: query, query2: "", query3: "", query4: "" } });
const facts = (input: QaModelInput) => JSON.parse(input.messages.slice(-1)[0]!.content!);
const finish = (input: QaModelInput) => call("finish_research", {
  informationNeeds: [{ text: "回答当前问题", targetSource: facts(input).VERIFIED_EVIDENCE.length ? "current_book" : "model_knowledge", sourceName: "",
    evidenceIds: facts(input).VERIFIED_EVIDENCE.map((e: { evidenceId: string }) => e.evidenceId) }],
  externalEvidenceNeeded: [], insufficientEvidence: [], conclusion: "可以交付",
});

function fixture(decide: (input: QaModelInput, index: number) => QaToolCall[]) {
  const now = Date.now();
  const claim: QaClaim = {
    owner: "worker", token: "lease", generation: 1,
    snapshot: { version: 1, providerId: "test", modelId: "test", configUpdatedAt: null, tokenizerId: "test", contextWindowTokens: 64000, maxOutputTokens: 8192, policyVersion: QA_POLICY.version },
    conversation: { id: "conversation", userId: 1, bookId: 1, selection, status: "active", frozenReason: null, firstQuestion: "解释", createdAt: now, updatedAt: now },
    turn: { id: "turn", conversationId: "conversation", userId: 1, turnNumber: 1, question: "解释", answer: "", status: "running", errorCode: null, retryOfTurnId: null,
      deadline: now + QA_POLICY.deadlineMs, lastSequence: 0, phase: "context", citations: [], createdAt: now, updatedAt: now },
  };
  let models = 0, tools = 0, chars = 0, step = 0;
  const events: Array<Record<string, unknown>> = [];
  const history = { turns: [], research: [], historicalEvidence: [] };
  const fence = () => { if (claim.turn.status !== "running") throw new SelectionQaError("LEASE_LOST"); };
  const store: QaRuntimeStore = {
    claim: () => claim, maintain: () => {}, renew: () => {}, mutate: (_c, _n, fn) => fn(),
    remaining: () => ({ models: QA_POLICY.maxModelCalls - models, tools: QA_POLICY.maxToolCalls - tools, chars: QA_POLICY.maxReadChars - chars }),
    reserveModel: (_c, kind) => { fence(); if (models >= QA_POLICY.maxModelCalls - (kind === "final" ? 0 : 1)) throw new Error("model budget"); models++; },
    reserveTool: () => { fence(); if (tools >= QA_POLICY.maxToolCalls) throw new Error("tool budget"); tools++; return QA_POLICY.maxReadChars - chars; },
    chargeRead: (_c, n) => { fence(); chars += n; if (chars > QA_POLICY.maxReadChars) throw new Error("read budget"); },
    phase: (_c, phase, detail) => { fence(); events.push({ phase, ...detail }); },
    usage: () => { fence(); }, evidence: jest.fn(() => { fence(); }),
    beginAnswer: (_c, version) => { fence(); claim.turn.answerVersion = version; claim.turn.answer = ""; claim.turn.citations = []; },
    quality: (_c, judgment) => { fence(); claim.turn.quality = judgment; },
    append: (_c, text, citations) => { fence(); claim.turn.answer += text; claim.turn.citations.push(...citations); },
    finish: (_c, status, reason) => { fence(); claim.turn.status = status; claim.turn.errorCode = reason; }, history: () => history,
  };
  const model: QaModelPort = {
    snapshot: () => claim.snapshot, count: (_s, text) => Math.ceil(text.length / 4),
    complete: jest.fn(async (_u, _s, input) => ({ usage, toolCalls: decide(input, step++) })),
    stream: jest.fn(async (_u, _s, input, emit) => {
      await emit("已有结果");
      if (facts(input).VERIFIED_EVIDENCE.length) await emit("[[evidence:s1]]");
      return { usage, finishReason: "stop" };
    }),
  };
  const books: QaBookPort = {
    index: jest.fn(async () => ({ state: "ready" as const })),
    context: jest.fn(async () => passage("text")),
    searchCandidates: jest.fn(async () => ({ state: "ready" as const, candidates: [], unavailable: [], contextTruncated: false, budgetLimited: false })),
    searchPool: jest.fn(async () => { throw new Error("unused"); }), verifyCandidates: jest.fn(async () => { throw new Error("unused"); }),
    replay: jest.fn(async (_u, _s, items) => items),
    expandSelected: jest.fn(async (_u, _s, input) => ({ candidates: input.evidence, contextTruncated: false,
      contextWindows: input.evidence.map(e => ({ sectionIndex: e.sectionIndex, start: e.start, end: e.end, hitRanges: [{ sectionIndex: e.sectionIndex, start: e.start, end: e.end }] })) })),
  };
  const executor = new SelectionQaExecutor(store, passingQualityFixture(model), books, { get: () => ({ bookId: 1, title: "测试书" }) }, env =>
    new QaToolRegistry([...createQaReadingTools(env), ...createQaDeliveryTools(env.ledger, env.currentBook)]));
  return { claim, store, books, model, events, executor, history, run: () => executor.run(claim, new AbortController().signal) };
}

describe("autonomous QA execution protocol (scripted models, not a model-quality evaluation)", () => {
  it("answers directly without any reading, search or expansion", async () => {
    const f = fixture(input => [finish(input)]);
    await f.run();
    expect(f.claim.turn.status).toBe("completed");
    expect(f.books.context).not.toHaveBeenCalled();
    expect(f.books.searchCandidates).not.toHaveBeenCalled();
    expect(f.books.expandSelected).not.toHaveBeenCalled();
    expect(f.model.stream).toHaveBeenCalledTimes(1);
  });

  it("uses actual empty observations to change queries and permits a third search", async () => {
    const f = fixture((input, index) => {
      if (index > 0) expect(input.messages.filter(m => m.role === "tool").slice(-1)[0]!.content).toContain('"observationStatus":"empty"');
      return [index < 3 ? search(["原词", "同义词", "新线索"][index]) : finish(input)];
    });
    await f.run();
    expect(f.claim.turn.status).toBe("completed");
    expect(f.books.searchCandidates).toHaveBeenCalledTimes(3);
    expect((f.books.searchCandidates as jest.Mock).mock.calls.map(c => c[2].queries)).toEqual([["原词"], ["同义词"], ["新线索"]]);
  });

  it("returns expanded qualifications to the model, which can search again", async () => {
    const f = fixture((input, index) => {
      if (index === 0) return [search("影响")];
      if (index === 1) return [call("expand_evidence", { evidenceIds: [facts(input).VERIFIED_EVIDENCE[0].evidenceId], maxWindowChars: 1600 })];
      if (index === 2) {
        const observation = JSON.parse(input.messages.filter(m => m.role === "tool").slice(-1)[0]!.content!);
        expect(observation.results[0]).toMatchObject({ textReference: "VERIFIED_EVIDENCE", sourceEvidenceId: facts(input).VERIFIED_EVIDENCE[0].evidenceId });
        const expanded = facts(input).VERIFIED_EVIDENCE.find((e: { evidenceId: string }) => e.evidenceId === observation.results[0].evidenceId);
        expect(expanded.quote).toBe("有影响但不决定");
        expect(JSON.stringify(input.messages).split("有影响但不决定")).toHaveLength(2);
        return [search("影响与决定区别")];
      }
      return [finish(input)];
    });
    f.books.searchCandidates = jest.fn(async () => ({ state: "ready" as const, candidates: [passage("有影响")], unavailable: [], contextTruncated: false, budgetLimited: false }));
    f.books.expandSelected = jest.fn(async () => ({ candidates: [passage("有影响但不决定")], contextTruncated: false,
      contextWindows: [{ sectionIndex: 0, start: 0, end: 7, hitRanges: [{ sectionIndex: 0, start: 0, end: 3 }] }] }));
    await f.run();
    expect(f.claim.turn.status).toBe("completed");
    expect(f.books.searchCandidates).toHaveBeenCalledTimes(2);
    expect(f.books.expandSelected).toHaveBeenCalledTimes(1);
    expect(f.events.find(e => e.operation === "evidence_expansion" && e.state === "completed")).toMatchObject({ results: [expect.objectContaining({ text: "有影响但不决定" })] });
    const final = (f.model.stream as jest.Mock).mock.calls[0][2];
    expect(JSON.stringify(final.messages).split("有影响但不决定")).toHaveLength(2);
  });

  it("returns a recoverable malformed parameter observation and executes the correction", async () => {
    const f = fixture((input, index) => {
      if (index === 0) return [{ id: "broken", name: "search_book", arguments: "{" }];
      if (index === 1) {
        expect(input.messages.filter(m => m.role === "tool").slice(-1)[0]!.content).toContain("recoverable_error");
        return [search("修正词")];
      }
      return [finish(input)];
    });
    await f.run();
    expect(f.claim.turn.status).toBe("completed");
    expect(f.books.searchCandidates).toHaveBeenCalledTimes(1);
    expect(f.store.remaining(f.claim).tools).toBe(QA_POLICY.maxToolCalls - 2);
  });

  it("identifies the exact oversized delivery field so the model can correct it", async () => {
    const f = fixture((input, index) => {
      if (index === 0) {
        const action = finish(input), args = JSON.parse(action.arguments);
        args.informationNeeds.push({ ...args.informationNeeds[0], text: "长".repeat(230) });
        return [call("finish_research", args)];
      }
      expect(JSON.parse(input.messages.filter(m => m.role === "tool").slice(-1)[0]!.content!)).toMatchObject({
        observationStatus: "recoverable_error",
        validation: { field: "informationNeeds[1].text", constraint: "length", actual: 230, minimum: 1, maximum: 200 },
      });
      return [finish(input)];
    });
    await f.run();
    expect(f.claim.turn.status).toBe("completed");
    expect(f.model.complete).toHaveBeenCalledTimes(2);
    expect(f.model.stream).toHaveBeenCalledTimes(1);
  });

  it.each([call("unknown", {}), call("search_book", { bookId: 2 }), call("expand_evidence", { evidenceIds: ["foreign"], maxWindowChars: 100 })])
  ("fails unknown tools, scope injection and foreign evidence without a final model call: %j", async action => {
    const f = fixture(() => [action]);
    await f.run();
    expect(f.claim.turn.status).toBe("failed");
    expect(f.model.stream).not.toHaveBeenCalled();
    expect(f.books.searchCandidates).not.toHaveBeenCalled();
  });

  it("bounds identical empty actions and preserves the final model slot", async () => {
    const f = fixture(() => [search("重复词")]);
    await f.run();
    expect(f.books.searchCandidates).toHaveBeenCalledTimes(2);
    expect(f.events.some(e => e.observationStatus === "not_executed" && e.reason === "NO_PROGRESS")).toBe(true);
    expect(f.model.stream).toHaveBeenCalledTimes(1);
    expect(f.claim.turn).toMatchObject({ status: "failed", errorCode: "NO_PROGRESS", answer: "已有结果" });
    expect(f.store.remaining(f.claim).models).toBe(1);
  });

  it("delivers partial information when the model continues requesting distinct actions at the cap", async () => {
    const f = fixture((_input, index) => [search(`新词${index}`)]);
    await f.run();
    expect(f.books.searchCandidates).toHaveBeenCalledTimes(QA_POLICY.maxModelCalls - 2);
    expect(f.model.stream).toHaveBeenCalledTimes(1);
    expect(f.claim.turn).toMatchObject({ status: "failed", errorCode: "RESEARCH_BUDGET_EXHAUSTED" });
    const final = (f.model.stream as jest.Mock).mock.calls[0][2];
    expect(facts(final).HOST_OBSERVATIONS.observations[0].result).toContain('"observationStatus":"empty"');
  });

  it("allows a different successful path after a repeated action was blocked", async () => {
    const f = fixture((input, index) => [index < 3 ? search("旧词") : index === 3 ? search("新线索") : finish(input)]);
    f.books.searchCandidates = jest.fn(async (_u, _s, input) => ({ state: "ready" as const,
      candidates: input.queries[0] === "新线索" ? [passage("新信息")] : [], unavailable: [], contextTruncated: false, budgetLimited: false }));
    await f.run();
    expect(f.events.some(e => e.reason === "NO_PROGRESS")).toBe(true);
    expect(f.books.searchCandidates).toHaveBeenCalledTimes(3);
    expect(f.claim.turn).toMatchObject({ status: "completed", errorCode: null });
  });

  it("allows an index-building observation to become ready on the same query", async () => {
    const f = fixture((input, index) => [index < 3 ? search("同一个词") : finish(input)]);
    let calls = 0;
    f.books.searchCandidates = jest.fn(async () => ++calls < 3 ? { state: "building" as const, generation: "generation" }
      : { state: "ready" as const, candidates: [passage("就绪证据")], unavailable: [], contextTruncated: false, budgetLimited: false });
    await f.run();
    expect(f.books.searchCandidates).toHaveBeenCalledTimes(3);
    expect(f.claim.turn.status).toBe("completed");
  });

  it("starts final delivery while its reserved time is still available", async () => {
    const f = fixture(() => [search("不用执行")]);
    f.claim.turn.deadline = Date.now() + 30000;
    await f.run();
    expect(f.model.complete).not.toHaveBeenCalled();
    expect(f.model.stream).toHaveBeenCalledTimes(1);
    expect(f.claim.turn).toMatchObject({ status: "failed", errorCode: "RESEARCH_BUDGET_EXHAUSTED" });
  });

  it("delivers a clarification without book operations", async () => {
    const f = fixture(() => [call("request_clarification", { question: "你想了解第二点的哪部分？" })]);
    await f.run();
    expect(f.claim.turn.status).toBe("completed");
    expect(f.books.context).not.toHaveBeenCalled();
    expect(facts((f.model.stream as jest.Mock).mock.calls[0][2]).clarification).toContain("第二点");
  });

  it("distinguishes an interrupted tool from unstarted batch calls and fences its late evidence", async () => {
    jest.useFakeTimers();
    try {
      const f = fixture(() => [search("慢查询"), call("read_selection_context", {})]);
      let resolve!: (value: Awaited<ReturnType<QaBookPort["searchCandidates"]>>) => void;
      f.books.searchCandidates = jest.fn(() => new Promise(r => { resolve = r; }));
      const running = f.run();
      for (let i = 0; i < 30 && !(f.books.searchCandidates as jest.Mock).mock.calls.length; i++) await Promise.resolve();
      expect(f.books.searchCandidates).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(QA_POLICY.deadlineMs - QA_POLICY.finalReserveMs);
      await running;
      expect(f.events).toEqual(expect.arrayContaining([
        expect.objectContaining({ operation: "search_book", observationStatus: "interrupted" }),
        expect.objectContaining({ operation: "selection_context", observationStatus: "not_executed" }),
      ]));
      expect(f.books.context).not.toHaveBeenCalled();
      expect(f.store.remaining(f.claim).tools).toBe(QA_POLICY.maxToolCalls - 1);
      expect(f.claim.turn).toMatchObject({ status: "failed", errorCode: "RESEARCH_BUDGET_EXHAUSTED", answer: "已有结果" });
      resolve({ state: "ready", candidates: [passage("迟到证据")], unavailable: [], contextTruncated: false, budgetLimited: false });
      await Promise.resolve(); await Promise.resolve();
      expect(f.store.evidence).not.toHaveBeenCalled();
      expect(f.claim.turn.answer).toBe("已有结果");
    } finally { jest.useRealTimers(); }
  });
});
