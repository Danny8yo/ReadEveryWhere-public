import { createQaReadingTools } from "./tools/qa-reading-tools";
import { createQaDeliveryTools } from "./tools/qa-delivery-tools";
import { QaToolRegistry } from "./tools/qa-tool-registry";
import { QA_POLICY } from "./selection-qa-runtime.port";
import { finishPlan, passingQualityFixture } from "./selection-qa-decision.fixture";
import { createHash } from "node:crypto";
import { BOOK_MAX_EXPAND_CHARS } from "../../../intelligent-library/public/book-retrieval.port";
import { SelectionQaExecutor } from "./selection-qa.executor";
import { SelectionQaError, SelectionSnapshot } from "./selection-qa.types";
import type {
  QaBookPort,
  QaClaim,
  QaEvidence,
  QaModelPort,
  QaRuntimeStore,
  QaSavedEvidence,
  QaToolCall,
  QaUsage,
} from "./selection-qa-runtime.port";

const revision = {
  fileChecksum: "checksum",
  extractorVersion: "extractor",
  normalizationVersion: "normalization",
};
const usage: QaUsage = {
  promptTokens: 10,
  completionTokens: 2,
  totalTokens: 12,
};
function evidence(start = 0, length = 100): QaEvidence {
  const quote = start === 0 ? "当前选区" + "文".repeat(length - 4) : "文".repeat(length);
  return {
    sectionIndex: 0,
    href: "chapter.xhtml",
    start,
    end: start + length,
    quote,
    displayedQuote: quote,
    quoteHash: createHash("sha256").update(quote).digest("hex"),
    cfi: `epubcfi(/6/2!/4/2,/1:${start},/1:${start + length})`,
    locator: {
      version: 1,
      bookId: 1,
      contentRevision: revision,
      position: {
        kind: "epub_text",
        sectionIndex: 0,
        start,
        end: start + length,
      },
    },
  };
}
function claim(): QaClaim {
  const now = Date.now();
  const selection: SelectionSnapshot = {
    scope: { bookId: 1, ...revision, sectionIndex: 0, href: "chapter.xhtml" },
    artifact: {
      bookId: 1,
      artifactId: "artifact",
      fileChecksum: revision.fileChecksum,
    },
    start: 0,
    end: 4,
    canonicalQuote: "当前选区",
    displayedQuote: "当前选区",
    source: { start: { path: [0], offset: 0 }, end: { path: [0], offset: 4 } },
  };
  return {
    owner: "owner",
    token: "token",
    generation: 1,
    turn: {
      id: "current",
      userId: 1,
      conversationId: "conversation",
      turnNumber: 1,
      question: "Explain this passage",
      answer: "",
      status: "running",
      phase: "reading",
      citations: [],
      errorCode: null,
      retryOfTurnId: null,
      deadline: now + QA_POLICY.deadlineMs,
      lastSequence: 0,
      createdAt: now,
      updatedAt: now,
    },
    conversation: {
      id: "conversation",
      userId: 1,
      bookId: 1,
      selection,
      status: "active",
      frozenReason: null,
      firstQuestion: "First question",
      createdAt: now,
      updatedAt: now,
    },
    snapshot: {
      version: 1,
      providerId: "fake",
      modelId: "fake",
      configUpdatedAt: null,
      tokenizerId: "fake",
      contextWindowTokens: 64000,
      maxOutputTokens: 4096,
      policyVersion: QA_POLICY.version,
    },
  };
}
class StrictStore implements QaRuntimeStore {
  active = true;
  models = 0;
  finalReserved = false;
  reservedModelKinds: Array<"decision" | "final" | "check"> = [];
  tools = 0;
  chars = 0;
  answer = "";
  citations: QaSavedEvidence[] = [];
  saved: QaSavedEvidence[] = [];
  terminal: { status: string; reason: string | null } | null = null;
  phases: string[] = [];
  historyValue: ReturnType<QaRuntimeStore["history"]> = {
    turns: [],
    historicalEvidence: [],
    research: [],
  };
  private guard() {
    if (!this.active) throw new SelectionQaError("LEASE_LOST");
  }
  claim(): QaClaim | null {
    throw new Error("scheduler-only");
  }
  maintain(): void {
    throw new Error("scheduler-only");
  }
  mutate<T>(_c: QaClaim, _now: number, action: () => T): T {
    this.guard();
    return action();
  }
  renew(): void {
    this.guard();
  }
  reserveModel(_claim: QaClaim, kind: "decision" | "final" | "check"): void {
    this.guard();
    if (this.models >= QA_POLICY.maxModelCalls - (kind === "decision" ? 2 : kind === "final" ? 1 : 0))
      throw new SelectionQaError("MODEL_BUDGET_EXHAUSTED");
    this.finalReserved = kind === "final";
    this.models++;
    this.reservedModelKinds.push(kind);
  }
  reserveTool(): number {
    this.guard();
    if (this.tools >= 6 || this.chars >= 24000)
      throw new SelectionQaError("TOOL_BUDGET_EXHAUSTED");
    this.tools++;
    return 24000 - this.chars;
  }
  chargeRead(_c: QaClaim, chars: number): void {
    this.guard();
    if (!Number.isSafeInteger(chars) || chars < 0 || this.chars + chars > 24000)
      throw new SelectionQaError("READ_BUDGET_EXHAUSTED");
    this.chars += chars;
  }
  remaining() {
    this.guard();
    return {
      models: QA_POLICY.maxModelCalls - this.models,
      tools: 6 - this.tools,
      chars: 24000 - this.chars,
    };
  }
  phase(_c: QaClaim, phase: string): void {
    this.guard();
    this.phases.push(phase);
  }
  usage(_c: QaClaim, actual: QaUsage, maxOutputTokens: number): void {
    this.guard();
    expect(actual.completionTokens).toBeLessThanOrEqual(maxOutputTokens);
  }
  evidence(_c: QaClaim, e: QaSavedEvidence): void {
    this.guard();
    expect(this.saved.some((x) => x.evidenceId === e.evidenceId)).toBe(false);
    this.saved.push(e);
  }
  beginAnswer(): void { this.guard(); this.answer = ""; this.citations = []; }
  quality(): void { this.guard(); }
  append(_c: QaClaim, text: string, citations: QaSavedEvidence[]): void {
    this.guard();
    expect(this.answer.length + text.length).toBeLessThanOrEqual(64000);
    this.answer += text;
    this.citations.push(...citations);
  }
  finish(
    _c: QaClaim,
    status: "completed" | "failed" | "timed_out",
    reason: string | null,
  ): void {
    this.guard();
    this.terminal = { status, reason };
    this.active = false;
  }
  history() {
    this.guard();
    return this.historyValue;
  }
}
function harness(initialLength = 100) {
  const c = claim(),
    store = new StrictStore(),
    controller = new AbortController();
  let actualBooks = 0,
    actualModels = 0;
  const bookCall = () => {
    expect(store.tools).toBe(++actualBooks);
    expect(actualBooks).toBeLessThanOrEqual(6);
  };
  const modelCall = () => {
    expect(store.models).toBe(++actualModels);
    expect(actualModels).toBeLessThanOrEqual(QA_POLICY.maxModelCalls);
  };
  const books: QaBookPort = {
    index: jest.fn(async () => ({ state: "ready" as const })),
    context: jest.fn(async (_user, _selection, input) => {
      bookCall();
      expect(input.maxChars).toBeLessThanOrEqual(24000 - store.chars);
      return evidence(0, initialLength);
    }),
    searchCandidates: jest.fn(async (_user, _selection, input) => {
      bookCall();
      expect(input.maxChars).toBeLessThanOrEqual(24000 - store.chars);
      expect(input.maxChars).toBeLessThanOrEqual(12000);
      return {
        state: "ready" as const,
        candidates: Array.from({ length: Math.min(input.limit, Math.floor(input.maxChars / 1200)) }, (_, n) =>
          evidence(10000 + actualBooks * 10000 + n * 1200, 1200),
        ),
        budgetLimited: false, contextTruncated: false, unavailable: [],
      };
    }),
    expandSelected: jest.fn(async (_user, _selection, input) => {
      bookCall();
      expect(input.maxChars).toBeLessThanOrEqual(24000 - store.chars);
      expect(input.maxChars).toBeLessThanOrEqual(BOOK_MAX_EXPAND_CHARS);
      return { candidates: input.evidence, contextWindows: input.evidence.map(e => ({ sectionIndex: e.sectionIndex, start: e.start, end: e.end, hitRanges: [{ sectionIndex: e.sectionIndex, start: e.start, end: e.end }] })), contextTruncated: false };
    }),
    searchPool: jest.fn(async () => { throw new Error("unused"); }), verifyCandidates: jest.fn(async () => { throw new Error("unused"); }),
    replay: jest.fn(async (_user, _selection, ranges) => {
      bookCall();
      return ranges;
    }),
  };
  const model: QaModelPort = {
    snapshot: () => c.snapshot,
    count: () => 100,
    complete: jest.fn(async (_u, _s, input) => {
      modelCall();
      return { toolCalls: store.models === 1 ? [{ id: "selection", name: "read_selection_context", arguments: "{}" }] : finishPlan(input), usage };
    }),
    stream: jest.fn(async (_user, _snapshot, input, onDelta) => {
      modelCall();
      expect(input.tools).toBeUndefined();
      expect(input.maxOutputTokens).toBe(4096);
      const selected = JSON.parse(input.messages[input.messages.length - 1].content!).VERIFIED_EVIDENCE;
      await onDelta("Final answer" + (selected.length ? ` [[evidence:${selected[0].evidenceId}]]` : ""));
      return { usage, finishReason: "stop" };
    }),
  };
  return {
    c,
    store,
    model,
    books,
    controller,
    modelCall,
    bookCall,
    run: () =>
      new SelectionQaExecutor(store, passingQualityFixture(model, modelCall), books, { get: (_userId, bookId) => ({ bookId, title: "大型网站技术架构" }) }, env => new QaToolRegistry([...createQaReadingTools(env), ...createQaDeliveryTools(env.ledger, env.currentBook)])).run(c, controller.signal),
  };
}
const search = (id: string): QaToolCall => ({
  id,
  name: "search_book",
  arguments: JSON.stringify({ informationNeed: "解释本书概念", queries: { query1: "知识", query2: "", query3: "", query4: "" } }),
});

describe("independent executor budget and streaming protocol", () => {
  it("delivers a truthful limited result when only the persisted final slot remains", async () => {
    const h = harness();
    h.store.models = QA_POLICY.maxModelCalls - 2;
    h.model.stream = jest.fn(async (_u, _s, _input, onDelta) => {
      expect(h.store.models).toBe(QA_POLICY.maxModelCalls - 1);
      await onDelta("Available findings only; the research budget is exhausted.");
      return { usage, finishReason: "stop" };
    });
    await h.run();
    expect(h.store.reservedModelKinds).toEqual(["final"]);
    expect(h.model.complete).not.toHaveBeenCalled();
    expect(h.model.stream).toHaveBeenCalledTimes(1);
    expect(h.store.answer).toContain("budget is exhausted");
    expect(h.store.terminal).toEqual({ status: "failed", reason: "RESEARCH_BUDGET_EXHAUSTED" });
  });
  it("permits a third search and preserves the final model reservation", async () => {
    const h = harness();
    let round = 0;
    h.books.searchCandidates = jest.fn(async (_u, _s, input) => {
      h.bookCall();
      expect(input.maxChars).toBeLessThanOrEqual(QA_POLICY.maxReadChars - h.store.chars);
      return { state: "ready" as const, candidates: [evidence(10000 + round * 1000, 100)], unavailable: [], budgetLimited: false, contextTruncated: false };
    });
    h.model.complete = jest.fn(async (_u, _s, input) => {
      h.modelCall(); round++;
      return { toolCalls: round < 4 ? [{ ...search(`${round}a`), arguments: JSON.stringify({ informationNeed: `解释本书概念${round}`, queries: { query1: `知识${round}`, query2: "", query3: "", query4: "" } }) }] : finishPlan(input), usage };
    });
    await h.run();
    expect(h.store.models).toBe(6);
    expect(h.model.complete).toHaveBeenCalledTimes(4);
    expect(h.model.stream).toHaveBeenCalledTimes(1);
    expect(h.store.reservedModelKinds).toEqual(["decision", "decision", "decision", "decision", "final", "check"]);
    expect(h.store.tools).toBe(3);
    expect(h.books.context).not.toHaveBeenCalled();
    expect(h.books.searchCandidates).toHaveBeenCalledTimes(3);
    expect(h.store.terminal?.status).toBe("completed");
  });
  it("charges explicit selection, historical and expansion reads before clamping search to 24000", async () => {
    const h = harness(4000);
    h.store.historyValue.historicalEvidence = [0, 1].map(n => ({ ...evidence(10000 + n * 4000, 4000), evidenceId: `old-${n}`, turnId: "previous" }));
    h.books.searchCandidates = jest.fn(async (_u, _s, input) => {
      h.bookCall();
      expect(input.maxChars).toBe(8000);
      return { state: "ready" as const, candidates: [evidence(50000, input.maxChars)], unavailable: [], budgetLimited: false, contextTruncated: false };
    });
    h.model.complete = jest.fn(async (_u, _s, input) => {
      h.modelCall();
      const calls: Record<number, QaToolCall[]> = {
        1: [{ id: "selection", name: "read_selection_context", arguments: "{}" }],
        2: [{ id: "history", name: "read_history_evidence", arguments: JSON.stringify({ evidenceIds: ["old-0", "old-1"] }) }],
        3: [{ id: "expand", name: "expand_evidence", arguments: JSON.stringify({ evidenceIds: [h.store.saved[0]?.evidenceId], maxWindowChars: 4000 }) }],
        4: [search("query")],
      };
      return { toolCalls: calls[h.store.models] ?? finishPlan(input), usage };
    });
    await h.run();
    expect(h.store.chars).toBe(24000);
    expect(h.store.tools).toBe(4);
    expect(h.books.context).toHaveBeenCalledTimes(1);
    expect(h.books.replay).toHaveBeenCalledTimes(1);
    expect(h.books.searchCandidates).toHaveBeenCalledTimes(1);
    expect(h.books.expandSelected).toHaveBeenCalledTimes(1);
    expect(h.store.models).toBe(7);
    expect(h.store.saved.filter(e => e.importedFromTurnId === "previous")).toHaveLength(2);
    expect(h.store.saved.every(e => !e.evidenceId.startsWith("old-"))).toBe(true);
    expect(h.store.terminal?.status).toBe("completed");
  });
  it("accepts a citation split at every character and emits its provenance only once", async () => {
    const h = harness();
    let expected = "";
    h.model.stream = jest.fn(async (_u, _s, _i, onDelta) => {
      h.modelCall();
      const id = h.store.saved[0].evidenceId;
      expected = `A[[evidence:${id}]]B[[evidence:${id}]]`;
      for (const character of expected) await onDelta(character);
      return { usage, finishReason: "stop" };
    });
    await h.run();
    expect(h.store.answer).toBe(expected);
    expect(h.store.citations).toHaveLength(1);
    expect(h.store.terminal?.status).toBe("completed");
  });
  it.each(["double", "footnote"])("normalizes verified %s references across stream boundaries", async (format) => {
    const h = harness();
    let expected = "";
    h.model.stream = jest.fn(async (_u, _s, _i, onDelta) => {
      h.modelCall();
      const id = h.store.saved[0].evidenceId;
      expected = `A[[evidence:${id}]]B`;
      const text = format === "double" ? `A[[${id}]]B` : `A[^${id}]B`;
      for (const character of text) await onDelta(character);
      return { usage, finishReason: "stop" };
    });
    await h.run();
    expect(h.store.answer).toBe(expected);
    expect(h.store.citations).toHaveLength(1);
    expect(h.store.terminal?.status).toBe("completed");
  });
  it.each(["[[e_forged]]", "[^e_forged]", "[[e_unfinished", "[^e_unfinished"])(
    "rejects unverified or unfinished alternate reference %s", async (literal) => {
      const h = harness();
      h.model.stream = jest.fn(async (_u, _s, _i, onDelta) => {
        h.modelCall();
        await onDelta("Accepted.");
        for (const character of literal) await onDelta(character);
        return { usage, finishReason: "stop" };
      });
      await h.run();
      expect(h.store.answer).toBe("Accepted.");
      expect(h.store.citations).toEqual([]);
      expect(h.store.terminal).toEqual({ status: "failed", reason: "CITATION_INVALID" });
    },
  );
  it.each(["forged", "old-id"])(
    "rejects unknown or non-imported historical citation %s",
    async (id) => {
      const h = harness();
      h.model.stream = jest.fn(async (_u, _s, _i, onDelta) => {
        h.modelCall();
        await onDelta("Preserved prefix.");
        await onDelta(`[[evidence:${id}]]`);
        return { usage, finishReason: "stop" };
      });
      await h.run();
      expect(h.store.answer).toBe("Preserved prefix.");
      expect(h.store.citations).toEqual([]);
      expect(h.store.terminal).toEqual({
        status: "failed",
        reason: "CITATION_INVALID",
      });
    },
  );
  it.each([null, "length", "content_filter"])(
    "does not complete a partial stream with finishReason=%s",
    async (finishReason) => {
      const h = harness();
      h.model.stream = jest.fn(async (_u, _s, _i, onDelta) => {
        h.modelCall();
        await onDelta("Partial answer");
        return { usage, finishReason };
      });
      await h.run();
      expect(h.store.answer).toBe("Partial answer");
      expect(h.store.terminal?.status).toBe("failed");
      expect(h.store.terminal?.reason).toBe(
        finishReason === "length" ? "OUTPUT_LIMIT" : "MODEL_STREAM_INCOMPLETE",
      );
    },
  );
  it("replays historical evidence before exposing its newly issued current-turn ID", async () => {
    const h = harness();
    const old = {
      ...evidence(2000, 200),
      evidenceId: "old-id",
      turnId: "previous",
    };
    h.store.historyValue.historicalEvidence = [old];
    h.model.complete = jest.fn(async (_u, _s, input) => {
      h.modelCall();
      if (h.store.models === 1) {
        expect(h.books.replay).not.toHaveBeenCalled();
        return { toolCalls: [{ id: "history", name: "read_history_evidence", arguments: JSON.stringify({ evidenceIds: [old.evidenceId] }) }], usage };
      }
      expect(h.books.replay).toHaveBeenCalledWith(1, h.c.conversation.selection, [old], h.c.turn.deadline - QA_POLICY.finalReserveMs, expect.any(AbortSignal));
      return { toolCalls: finishPlan(input), usage };
    });
    h.model.stream = jest.fn(async (_u, _s, _i, onDelta) => {
      h.modelCall();
      const imported = h.store.saved.find(
        (e) => e.importedFromTurnId === "previous",
      )!;
      expect(imported.evidenceId).not.toBe(old.evidenceId);
      await onDelta(`[[evidence:${imported.evidenceId}]]`);
      return { usage, finishReason: "stop" };
    });
    await h.run();
    expect(h.store.tools).toBe(1);
    expect(h.store.chars).toBe(200);
    expect(h.store.citations[0].start).toBe(old.start);
  });
  it("rejects late deltas after terminal completion without changing persisted answer", async () => {
    const h = harness();
    let emit!: (text: string) => Promise<void>;
    let answer = "";
    h.model.stream = jest.fn(async (_u, _s, _i, onDelta) => {
      h.modelCall();
      emit = onDelta;
      answer = `Complete [[evidence:${h.store.saved[0].evidenceId}]]`;
      await onDelta(answer);
      return { usage, finishReason: "stop" };
    });
    await h.run();
    expect(h.store.terminal).toEqual({ status: "completed", reason: null });
    await expect(emit("LATE")).rejects.toMatchObject({ code: "ANSWER_VERSION_FROZEN" });
    expect(h.store.answer).toBe(answer);
  });
  it("rejects late deltas after user stop even when the provider resolves afterwards", async () => {
    const h = harness();
    let emit!: (text: string) => Promise<void>,
      ready!: () => void,
      release!: () => void;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.model.stream = jest.fn(async (_u, _s, _i, onDelta) => {
      h.modelCall();
      emit = onDelta;
      await onDelta("Partial");
      ready();
      await gate;
      return { usage, finishReason: "stop" };
    });
    const running = h.run();
    await started;
    h.store.active = false;
    h.store.terminal = { status: "cancelled", reason: "USER_STOPPED" };
    h.controller.abort("USER_STOPPED");
    await running;
    await expect(emit("LATE")).rejects.toMatchObject({ code: "USER_STOPPED" });
    release();
    await Promise.resolve();
    expect(h.store.answer).toBe("Partial");
    expect(h.store.terminal).toEqual({
      status: "cancelled",
      reason: "USER_STOPPED",
    });
  });
  it("does not expose unverified historical evidence after replay failure", async () => {
    const h = harness();
    h.store.historyValue.historicalEvidence = [{ ...evidence(2000, 200), evidenceId: "old-id", turnId: "previous" }];
    h.model.complete = jest.fn(async () => {
      h.modelCall();
      return { toolCalls: [{ id: "history", name: "read_history_evidence", arguments: JSON.stringify({ evidenceIds: ["old-id"] }) }], usage };
    });
    h.books.replay = jest.fn(async () => { throw new SelectionQaError("CONTENT_VERSION_CHANGED"); });
    await h.run();
    expect(h.model.complete).toHaveBeenCalledTimes(1);
    expect(h.model.stream).not.toHaveBeenCalled();
    expect(h.store.saved).toHaveLength(0);
    expect(h.store.terminal).toEqual({ status: "failed", reason: "CONTENT_VERSION_CHANGED" });
  });
  it("fails an unfinished citation marker and keeps only previously accepted text", async () => {
    const h = harness();
    h.model.stream = jest.fn(async (_u, _s, _i, onDelta) => {
      h.modelCall();
      await onDelta("Accepted.");
      await onDelta("[[evidence:");
      return { usage, finishReason: "stop" };
    });
    await h.run();
    expect(h.store.answer).toBe("Accepted.");
    expect(h.store.citations).toEqual([]);
    expect(h.store.terminal).toEqual({
      status: "failed",
      reason: "CITATION_INVALID",
    });
  });
});
