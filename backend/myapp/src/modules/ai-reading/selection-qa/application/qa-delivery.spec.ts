import { QaContextBuilder } from "./qa-context";
import { QaDelivery, type QaDeliveryInput } from "./qa-delivery";
import type { QaClaim, QaModelInput, QaModelPort, QaRuntimeStore, QaSavedEvidence, QaUsage } from "./selection-qa-runtime.port";
import { SelectionQaError } from "./selection-qa.types";

const usage: QaUsage = { promptTokens: 10, completionTokens: 10, totalTokens: 20 };

function fixture() {
  let active = true;
  let answer = "";
  let terminal: { status: string; reason: string | null } | undefined;
  const published: QaSavedEvidence[] = [];
  const controller = new AbortController();
  const guard = () => { if (!active) throw new SelectionQaError("LEASE_LOST"); };
  const store = {
    reserveModel: jest.fn(guard),
    beginAnswer: jest.fn(guard),
    phase: jest.fn(guard),
    usage: jest.fn(guard),
    append: jest.fn((_claim, text: string, evidence: QaSavedEvidence[]) => { guard(); answer += text; published.push(...evidence); }),
    finish: jest.fn((_claim, status: string, reason: string | null) => { guard(); terminal = { status, reason }; active = false; }),
  } as unknown as QaRuntimeStore;
  const claim = {
    turn: { id: "turn", userId: 1, deadline: Date.now() + 60000 },
    snapshot: { modelId: "model" },
  } as QaClaim;
  const evidence = {
    evidenceId: "e_allowed", quote: "支持限定的原文", quoteHash: "hash", displayedQuote: "支持限定的原文", cfi: "cfi",
    sectionIndex: 0, href: "chapter.xhtml", start: 0, end: 8,
    locator: { version: 1, bookId: 1, contentRevision: { fileChecksum: "checksum", extractorVersion: "v1", normalizationVersion: "v1" }, position: { kind: "epub_text", sectionIndex: 0, start: 0, end: 8 } },
  } as QaSavedEvidence;
  const request: QaModelInput = { turnId: "turn", messages: [], signal: controller.signal, timeoutMs: 60000, maxOutputTokens: 8192 };
  const builder = { build: jest.fn(() => request) } as unknown as QaContextBuilder;
  const model = {
    stream: jest.fn(async (_user, _snapshot, _input, onDelta: (text: string) => Promise<void>) => {
      await onDelta("回答[[evidence:s1]]");
      return { usage, finishReason: "stop" };
    }),
  } as unknown as QaModelPort;
  const input: QaDeliveryInput = {
    claim, answerVersion: 1, currentBook: { bookId: 1, title: "测试书" }, history: { turns: [], historicalEvidence: [], research: [] },
    messages: [], evidence: new Map([[evidence.evidenceId, evidence]]), signal: controller.signal,
    searchOutcome: { succeeded: 1, failed: 0 },
    decision: { informationNeeds: [], selectedEvidenceIds: [evidence.evidenceId], externalEvidenceNeeded: [], insufficientEvidence: [], conclusion: "可以回答" },
  };
  return {
    store, model, builder, input, controller,
    deliver: () => new QaDelivery(store, model, builder).deliver(input),
    answer: () => answer,
    citations: () => published,
    terminal: () => terminal,
    stop: () => { active = false; terminal = { status: "cancelled", reason: "USER_STOPPED" }; controller.abort("USER_STOPPED"); },
  };
}

describe("QA final streaming delivery", () => {
  it("publishes deltas before provider completion and reserves exactly the final model slot", async () => {
    const h = fixture();
    let started!: () => void;
    let continueStream!: () => void;
    const first = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { continueStream = resolve; });
    h.model.stream = jest.fn(async (_user, _snapshot, _input, onDelta) => {
      await onDelta("第一段");
      started();
      await gate;
      await onDelta("第二段[[evidence:s1]]");
      return { usage, finishReason: "stop" };
    });
    const running = h.deliver();
    await first;
    expect(h.answer()).toBe("第一段");
    expect(h.terminal()).toBeUndefined();
    continueStream();
    await running;
    expect(h.answer()).toBe("第一段第二段[[evidence:e_allowed]]");
    expect(h.store.reserveModel).toHaveBeenCalledTimes(1);
    expect(h.store.reserveModel).toHaveBeenCalledWith(h.input.claim, "final");
    expect(h.builder.build).toHaveBeenCalledWith(expect.objectContaining({ final: true, tools: [], deadline: h.input.claim.turn.deadline }));
    expect(h.terminal()).toBeUndefined();
  });

  it.each(["[[evidence:s1]]", "[[evidence:e_allowed]]", "[[e_allowed]]", "[^e_allowed]"])(
    "normalizes a verified %s citation split at every character and publishes provenance once",
    async marker => {
      const h = fixture();
      h.model.stream = jest.fn(async (_user, _snapshot, _input, onDelta) => {
        for (const character of `A${marker}B${marker}`) await onDelta(character);
        return { usage, finishReason: "stop" };
      });
      await h.deliver();
      expect(h.answer()).toBe("A[[evidence:e_allowed]]B[[evidence:e_allowed]]");
      expect(h.citations()).toHaveLength(1);
      expect(h.citations()[0].evidenceId).toBe("e_allowed");
    },
  );

  it.each(["[[evidence:forged]]", "[[evidence:s9]]", "[[e_forged]]", "[^e_forged]", "[[evidence:", "[[e_unfinished"])(
    "rejects an unknown or unfinished marker %s without losing previously accepted text",
    async marker => {
      const h = fixture();
      h.model.stream = jest.fn(async (_user, _snapshot, _input, onDelta) => {
        await onDelta("保留已有内容。");
        for (const character of marker) await onDelta(character);
        return { usage, finishReason: "stop" };
      });
      await expect(h.deliver()).rejects.toMatchObject({ code: "CITATION_INVALID" });
      expect(h.answer()).toBe("保留已有内容。");
      expect(h.citations()).toEqual([]);
      expect(h.store.finish).not.toHaveBeenCalled();
    },
  );

  it("rejects a selected-evidence answer that only emits unbound numeric references", async () => {
    const h = fixture();
    h.model.stream = jest.fn(async (_user, _snapshot, _input, onDelta) => {
      await onDelta("书中明确指出这一点[1]");
      return { usage, finishReason: "stop" };
    });
    await expect(h.deliver()).rejects.toMatchObject({ code: "CITATION_INVALID" });
    expect(h.store.finish).not.toHaveBeenCalled();
  });

  it("truthfully marks a limited successful stream as limited, retaining its supported content", async () => {
    const h = fixture();
    h.input.limitReason = "NO_PROGRESS_LIMIT";
    await expect(h.deliver()).rejects.toMatchObject({ code: "NO_PROGRESS_LIMIT" });
    expect(h.answer()).toBe("回答[[evidence:e_allowed]]");
    expect(h.terminal()).toBeUndefined();
  });

  it("streams a clarification with no source evidence and completes this conversational turn", async () => {
    const h = fixture();
    h.input.evidence = new Map();
    h.input.decision = undefined;
    h.input.clarification = "你指的是哪个例子？";
    h.model.stream = jest.fn(async (_user, _snapshot, _input, onDelta) => {
      await onDelta("你指的是");
      await onDelta("哪个例子？");
      return { usage, finishReason: "stop" };
    });
    await h.deliver();
    expect(h.answer()).toBe("你指的是哪个例子？");
    expect(h.store.append).toHaveBeenCalledTimes(2);
    expect(h.terminal()).toBeUndefined();
  });

  it.each([["length", "OUTPUT_LIMIT"], [null, "MODEL_STREAM_INCOMPLETE"], ["content_filter", "MODEL_STREAM_INCOMPLETE"]])(
    "does not report a successful final answer when the provider exits with %s",
    async (finishReason, expected) => {
      const h = fixture();
      h.model.stream = jest.fn(async (_user, _snapshot, _input, onDelta) => {
        await onDelta("已有部分文字");
        return { usage, finishReason };
      });
      await expect(h.deliver()).rejects.toMatchObject({ code: expected });
      expect(h.answer()).toBe("已有部分文字");
      expect(h.terminal()).toBeUndefined();
    },
  );

  it("reports an output limit rather than an empty answer for an empty truncated stream", async () => {
    const h = fixture();
    h.model.stream = jest.fn(async () => ({ usage, finishReason: "length" }));
    await expect(h.deliver()).rejects.toMatchObject({ code: "OUTPUT_LIMIT" });
    expect(h.store.finish).not.toHaveBeenCalled();
  });

  it("preserves cancellation and rejects late deltas and provider completion", async () => {
    const h = fixture();
    let emit!: (text: string) => Promise<void>;
    let started!: () => void;
    let finishProvider!: () => void;
    const first = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { finishProvider = resolve; });
    h.model.stream = jest.fn(async (_user, _snapshot, _input, onDelta) => {
      emit = onDelta;
      await onDelta("停止前的内容");
      started();
      await gate;
      return { usage, finishReason: "stop" };
    });
    const running = h.deliver();
    await first;
    h.stop();
    await expect(running).rejects.toMatchObject({ code: "USER_STOPPED" });
    await expect(emit("迟到内容")).rejects.toMatchObject({ code: "USER_STOPPED" });
    finishProvider();
    await Promise.resolve();
    expect(h.answer()).toBe("停止前的内容");
    expect(h.terminal()).toEqual({ status: "cancelled", reason: "USER_STOPPED" });
    expect(h.store.finish).not.toHaveBeenCalled();
  });

  it("rejects a late callback after normal completion through the persistent write fence", async () => {
    const h = fixture();
    let emit!: (text: string) => Promise<void>;
    h.model.stream = jest.fn(async (_user, _snapshot, _input, onDelta) => {
      emit = onDelta;
      await onDelta("回答[[evidence:s1]]");
      return { usage, finishReason: "stop" };
    });
    await h.deliver();
    await expect(emit("迟到")).rejects.toMatchObject({ code: "ANSWER_VERSION_FROZEN" });
    expect(h.answer()).toBe("回答[[evidence:e_allowed]]");
    expect(h.terminal()).toBeUndefined();
  });

  it("propagates unexpected provider errors to the executor without substituting an answer", async () => {
    const h = fixture();
    const failure = new Error("unexpected provider failure");
    h.model.stream = jest.fn(async () => { throw failure; });
    await expect(h.deliver()).rejects.toBe(failure);
    expect(h.answer()).toBe("");
    expect(h.store.finish).not.toHaveBeenCalled();
  });
});
