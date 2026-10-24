import { QaContextBuilder, type QaContextInput } from "./qa-context";
import type { QaClaim, QaMessage, QaModelPort, QaRuntimeStore, QaSavedEvidence } from "./selection-qa-runtime.port";

function fixture() {
  const now = Date.now();
  const revision = { fileChecksum: "checksum", extractorVersion: "extractor", normalizationVersion: "normalizer" };
  const selection = {
    scope: { bookId: 7, ...revision, sectionIndex: 0, href: "chapter.xhtml" },
    artifact: { bookId: 7, artifactId: "artifact", fileChecksum: "checksum" },
    start: 0, end: 4, canonicalQuote: "原始选文", displayedQuote: "原始选文",
    source: { start: { path: [0], offset: 0 }, end: { path: [0], offset: 4 } },
  };
  const claim: QaClaim = {
    owner: "owner", token: "token", generation: 1,
    snapshot: { version: 1, providerId: "test", modelId: "test", configUpdatedAt: null, tokenizerId: "test", contextWindowTokens: 64000, maxOutputTokens: 8192, policyVersion: "test" },
    conversation: { id: "conversation", userId: 1, bookId: 7, selection, status: "active", frozenReason: null, firstQuestion: "first", createdAt: now, updatedAt: now },
    turn: { id: "turn", userId: 1, conversationId: "conversation", turnNumber: 2, question: "你刚才第二点为什么？", answer: "", status: "running", phase: "planning", errorCode: null, retryOfTurnId: null, deadline: now + 60000, lastSequence: 0, citations: [], createdAt: now, updatedAt: now },
  };
  const model = { count: jest.fn(() => 100) } as unknown as QaModelPort;
  const store = {
    remaining: jest.fn(() => ({ models: 4, tools: 5, chars: 22000 })),
    phase: jest.fn(),
  } as unknown as QaRuntimeStore;
  const evidence: QaSavedEvidence = {
    evidenceId: "e_verified", quote: "新证据", displayedQuote: "新证据", quoteHash: "hash", cfi: "cfi",
    sectionIndex: 0, href: "chapter.xhtml", start: 0, end: 3,
    locator: { version: 1, bookId: 7, contentRevision: revision, position: { kind: "epub_text", sectionIndex: 0, start: 0, end: 3 } },
  };
  const input: QaContextInput = {
    claim, currentBook: { bookId: 7, title: "当前书" },
    history: { turns: [], historicalEvidence: [], research: [] },
    messages: [], evidence: new Map([[evidence.evidenceId, evidence]]),
    tools: [{ type: "function", function: { name: "custom_reading_tool", description: "Read", parameters: { type: "object" }, strict: true } }],
    signal: new AbortController().signal, final: false,
    searchOutcome: { succeeded: 1, failed: 0 }, deadline: now + 30000,
  };
  return { model, store, input, builder: new QaContextBuilder(model, store) };
}

const exchange = (id: string, result: string): QaMessage[] => [
  { role: "assistant", content: null, toolCalls: [{ id, name: "search_book", arguments: "{}" }] },
  { role: "tool", toolCallId: id, content: JSON.stringify({ operationKind: "reading", result }) },
];

const userFacts = (messages: QaMessage[]) => messages.filter(message => message.role === "user")
  .map(message => JSON.parse(message.content!));

describe("QA model context boundary", () => {
  it("records omitted old evidence in action context but refuses to certify a draft by dropping its qualification", () => {
    const {builder,input,model,store}=fixture();
    const first=input.evidence.get("e_verified")!;
    input.evidence=new Map([["e_old",{...first,evidenceId:"e_old",quote:"只适用于允许陈旧数据"}],[first.evidenceId,first]]);
    input.messages=exchange("latest",JSON.stringify({results:[{evidenceId:first.evidenceId}]}));
    model.count=jest.fn((_snapshot,text)=>text.includes("只适用于允许陈旧数据")?6000:100);
    input.claim.snapshot.contextWindowTokens=8192+1024+500;
    const action=builder.build(input);
    const facts=userFacts(action.messages).find(v=>v.VERIFIED_EVIDENCE);
    expect(facts.VERIFIED_EVIDENCE.some((e: {quote:string})=>e.quote.includes("只适用于"))).toBe(false);
    expect(facts.omittedEvidence).toMatchObject([{evidenceId:"e_old"}]);
    expect(store.phase).toHaveBeenLastCalledWith(input.claim,"planning",expect.objectContaining({purpose:"action",omittedEvidenceIds:["e_old"]}));
    input.final=true;input.qualityAnswer="缓存适用于任何场景。";
    expect(()=>builder.build(input)).toThrow("INPUT_TOKEN_LIMIT");
  });
  it("keeps actual historical answers for follow-up delivery without promoting them or model reasoning to source evidence", () => {
    const { builder, input } = fixture();
    input.final = true;
    input.history.turns = [{ id: "previous", question: "列出两点", answer: "第一点是A。第二点是B。[[evidence:old-id]]", status: "completed" }];
    input.messages = [
      { ...exchange("read", "实际新观察")[0], content: "不可信模型草稿", reasoningContent: "隐藏推理" },
      exchange("read", "实际新观察")[1],
      { role: "assistant", content: "未调用工具的模型草稿", reasoningContent: "另一段隐藏推理" },
      { role: "user", content: "请修正协议" },
    ];
    input.decision = {
      informationNeeds: [{ text: "解释第二点", targetSource: "current_book", sourceName: "", evidenceIds: ["e_verified"] }],
      selectedEvidenceIds: ["e_verified"], externalEvidenceNeeded: [], insufficientEvidence: ["第二点的适用条件仍需确认"], conclusion: "模型编造的全书否定结论",
    };
    const result = builder.build(input);
    const all = JSON.stringify(result.messages);
    expect(all).toContain("第二点是B");
    const history = userFacts(result.messages).find(item => item.contextType === "conversation_history");
    expect(history.recentTurns[0]).toMatchObject({ answer: "第一点是A。第二点是B。", answerProvenance: "prior_model_output_not_source_evidence" });
    expect(all).not.toContain("历史引用需重新验证");
    expect(all).not.toContain("old-id");
    expect(all).not.toContain("不可信模型草稿");
    expect(all).not.toContain("未调用工具的模型草稿");
    expect(all).not.toContain("隐藏推理");
    expect(all).not.toContain("模型编造的全书否定结论");
    expect(result.messages.some(message => message.role === "assistant" || message.role === "tool")).toBe(false);
    const facts = userFacts(result.messages).find(item => item.VERIFIED_EVIDENCE);
    expect(facts.HOST_OBSERVATIONS.observations).toEqual([{ toolCallId: "read", tool: "search_book", result: JSON.stringify({ operationKind: "reading", result: "实际新观察" }) }]);
    expect(facts.VERIFIED_EVIDENCE).toMatchObject([{ evidenceId: "s1", quote: "新证据", sourceBook: { title: "当前书" } }]);
    expect(facts.RESEARCH_DECISION.informationNeeds[0].evidenceIds).toEqual(["s1"]);
    expect(facts.RESEARCH_DECISION.selectedEvidenceIds).toEqual(["s1"]);
    expect(facts.RESEARCH_DECISION.insufficientEvidence).toEqual(["第二点的适用条件仍需确认"]);
    expect(facts.RESEARCH_DECISION.insufficientEvidenceProvenance).toBe("model_identified_unverified_gaps");
    expect(result.messages[0].content).toContain("They are not book facts or evidence of whole-book absence");
    expect(result.tools).toBeUndefined();
  });

  it("makes every action aware of the original selection, actual observations, tools and remaining resources", () => {
    const { builder, input } = fixture();
    input.messages = exchange("new-evidence", "扩展发现新限定");
    input.history.historicalEvidence = [{ ...input.evidence.get("e_verified")!, evidenceId: "old-reference", turnId: "previous" }];
    const result = builder.build(input);
    expect(result.tools).toEqual(input.tools);
    expect(result.messages).toEqual(expect.arrayContaining(input.messages));
    const facts = userFacts(result.messages);
    expect(facts.find(item => item.originalSelection)).toMatchObject({ originalSelection: "原始选文", originalSelectionProvenance: "question_context_not_citable_evidence", currentQuestion: "你刚才第二点为什么？" });
    expect(facts.find(item => item.VERIFIED_EVIDENCE)).toMatchObject({
      remainingBudget: { models: 4, decisionModels: 2, tools: 5, chars: 22000 },
      historicalEvidenceAvailable: [{ evidenceId: "old-reference", turnId: "previous" }],
    });
    expect(result.maxOutputTokens).toBe(3072);
    expect(result.timeoutMs).toBeLessThanOrEqual(30000);
  });

  it("trims oldest history before consumed exchanges and always keeps the latest full answer and observation", () => {
    const { builder, input, model, store } = fixture();
    input.history.turns = [
      { id: "old", question: "old question", answer: "old answer", status: "completed" },
      { id: "recent", question: "recent question", answer: "recent answer", status: "completed" },
    ];
    input.messages = [...exchange("old", "old observation"), ...exchange("recent", "latest observation")];
    model.count = jest.fn((_snapshot, text) => {
      const payload = JSON.parse(text);
      if (!payload.messages) return 20;
      const turns = userFacts(payload.messages).find(item => item.contextType === "conversation_history").recentTurns;
      const oldExchange = payload.messages.some((message: QaMessage) => message.toolCallId === "old");
      return 100 + (turns.length > 1 ? 50 : 0) + (oldExchange ? 50 : 0);
    });
    input.claim.snapshot.contextWindowTokens = 3072 + 1024 + 150;
    let result = builder.build(input);
    expect(JSON.stringify(result.messages)).not.toContain("old answer");
    expect(result.messages.some(message => message.toolCallId === "old")).toBe(true);
    input.claim.snapshot.contextWindowTokens = 3072 + 1024 + 100;
    result = builder.build(input);
    expect(result.messages.some(message => message.toolCallId === "old")).toBe(false);
    expect(result.messages.some(message => message.toolCallId === "recent")).toBe(true);
    expect(JSON.stringify(result.messages)).toContain("recent answer");
    expect(store.phase).toHaveBeenLastCalledWith(input.claim, "planning", expect.objectContaining({ omittedTurns: 1, includedTurns: 1, omittedExchanges: 1, remainingTokens: 0 }));
    expect(input.history.turns).toHaveLength(2);
    expect(input.messages).toHaveLength(4);
  });

  it("fails rather than discard the necessary latest history or observation", () => {
    const { builder, input, store } = fixture();
    input.history.turns = [{ id: "recent", question: "question", answer: "required answer", status: "completed" }];
    input.messages = exchange("recent", "required observation");
    input.claim.snapshot.contextWindowTokens = 3072 + 1024 + 99;
    expect(() => builder.build(input)).toThrow("INPUT_TOKEN_LIMIT");
    expect(store.phase).not.toHaveBeenCalled();
  });

  it("protects the latest actual answer across a newer empty failed turn and the latest observation across protocol repair", () => {
    const { builder, input, model } = fixture();
    input.history.turns = [
      { id: "answered", question: "question", answer: "necessary prior answer", status: "completed" },
      { id: "empty-failure", question: "failed attempt", answer: "", status: "failed" },
    ];
    input.messages = [
      ...exchange("last-result", "necessary latest observation"),
      { role: "assistant", content: "wrong protocol" },
      { role: "user", content: "please repair" },
    ];
    model.count = jest.fn((_snapshot, text) => {
      const parsed = JSON.parse(text);
      if (!parsed.messages) return 10;
      return JSON.stringify(parsed.messages).includes("necessary prior answer") &&
        parsed.messages.some((message: QaMessage) => message.toolCallId === "last-result") ? 101 : 100;
    });
    input.claim.snapshot.contextWindowTokens = 3072 + 1024 + 100;
    expect(() => builder.build(input)).toThrow("INPUT_TOKEN_LIMIT");
  });

  it("keeps the latest actual observation during limited delivery, with earlier observation omission explicit", () => {
    const { builder, input } = fixture();
    input.final = true;
    input.messages = [...exchange("old", "previous result"), ...exchange("last", "not_executed: resource budget")];
    input.limitReason = "MODEL_BUDGET_EXHAUSTED";
    const facts = userFacts(builder.build(input).messages).find(item => item.VERIFIED_EVIDENCE);
    expect(facts.HOST_OBSERVATIONS).toMatchObject({ omittedExchanges: 1, observations: [{ toolCallId: "last", result: JSON.stringify({ operationKind: "reading", result: "not_executed: resource budget" }) }] });
    expect(facts.RESEARCH_LIMITATIONS).toMatchObject({ budgetExhausted: true, limitReason: "MODEL_BUDGET_EXHAUSTED" });
    expect(facts.deliveryInstruction).toContain("Do not claim the task");
  });

  it("does not promote a delivery-tool conclusion into host observations or hide the latest reading behind it", () => {
    const { builder, input } = fixture();
    input.final = true;
    input.messages = [
      ...exchange("read", "真实但有限的阅读结果"),
      { role: "assistant", content: null, toolCalls: [{ id: "finish", name: "finish_research", arguments: "{}" }] },
      { role: "tool", toolCallId: "finish", content: JSON.stringify({ operationKind: "delivery", conclusion: "未经支持的全书否定", insufficientEvidence: ["书中从来没有"] }) },
    ];
    const result = builder.build(input);
    expect(JSON.stringify(result.messages)).not.toContain("未经支持的全书否定");
    expect(JSON.stringify(result.messages)).not.toContain("书中从来没有");
    const facts = userFacts(result.messages).find(item => item.VERIFIED_EVIDENCE);
    expect(facts.HOST_OBSERVATIONS.observations).toHaveLength(1);
    expect(facts.HOST_OBSERVATIONS.observations[0].result).toContain("真实但有限的阅读结果");
  });

  it("supports clarification and zero-evidence final answers without inventing a search", () => {
    const { builder, input } = fixture();
    input.final = true;
    input.evidence = new Map();
    input.clarification = "你指的是第二个例子还是第二个观点？";
    input.searchOutcome = { succeeded: 0, failed: 0 };
    const result = builder.build(input);
    const facts = userFacts(result.messages).find(item => item.VERIFIED_EVIDENCE);
    expect(facts.clarification).toBe(input.clarification);
    expect(facts.researchStatusInstruction).toContain("No new book search was executed");
    expect(facts.VERIFIED_EVIDENCE).toEqual([]);
    expect(result.maxOutputTokens).toBe(8192);
  });

  it("maps selected observation IDs to final citation aliases and marks unselected metadata as unavailable text", () => {
    const { builder, input } = fixture();
    input.final = true;
    const observation = {
      operationKind: "reading", observationStatus: "success", resultCount: 2,
      results: [
        { evidenceId: "e_verified", sourceEvidenceId: "e_unselected", textReference: "VERIFIED_EVIDENCE", start: 0, end: 3 },
        { evidenceId: "e_unselected", sourceEvidenceId: "e_verified", textReference: "VERIFIED_EVIDENCE", text: "未选正文不能回流最终输入", start: 4, end: 9 },
      ],
    };
    input.messages = [
      { role: "assistant", content: null, toolCalls: [{ id: "expanded", name: "expand_evidence", arguments: "{}" }] },
      { role: "tool", toolCallId: "expanded", content: JSON.stringify(observation) },
    ];
    const result = builder.build(input);
    const facts = userFacts(result.messages).find(item => item.VERIFIED_EVIDENCE);
    const projected = JSON.parse(facts.HOST_OBSERVATIONS.observations[0].result);
    expect(facts.VERIFIED_EVIDENCE).toHaveLength(1);
    expect(projected.results).toEqual([
      { observationEvidenceId: "e_verified", evidenceId: "s1", evidenceAvailability: "selected_for_delivery", textReference: "VERIFIED_EVIDENCE", start: 0, end: 3,
        observationSourceEvidenceId: "e_unselected", sourceEvidenceId: null, sourceEvidenceAvailability: "not_selected_for_delivery" },
      { observationEvidenceId: "e_unselected", evidenceId: "e_unselected", evidenceAvailability: "not_selected_for_delivery", textReference: null, start: 4, end: 9,
        observationSourceEvidenceId: "e_verified", sourceEvidenceId: "s1", sourceEvidenceAvailability: "selected_for_delivery" },
    ]);
    expect(JSON.stringify(result.messages)).not.toContain("未选正文不能回流最终输入");
    expect(result.messages[0].content).toContain("its metadata is not evidence text");
    expect(JSON.parse(input.messages[1].content!).results[0].evidenceId).toBe("e_verified");
  });

  it("leaves evidence metadata without a citable text reference when clarification selects no passages", () => {
    const { builder, input } = fixture();
    input.final = true;
    input.evidence = new Map();
    input.clarification = "你具体指哪个限定？";
    input.messages = [
      { role: "assistant", content: null, toolCalls: [{ id: "read", name: "search_book", arguments: "{}" }] },
      { role: "tool", toolCallId: "read", content: JSON.stringify({ operationKind: "reading", results: [{ evidenceId: "e_verified", textReference: "VERIFIED_EVIDENCE" }] }) },
    ];
    const facts = userFacts(builder.build(input).messages).find(item => item.VERIFIED_EVIDENCE);
    expect(facts.VERIFIED_EVIDENCE).toEqual([]);
    expect(JSON.parse(facts.HOST_OBSERVATIONS.observations[0].result).results).toEqual([
      { observationEvidenceId: "e_verified", evidenceId: "e_verified", evidenceAvailability: "not_selected_for_delivery", textReference: null },
    ]);
  });

  it("rejects unmatched tool results and unknown selected evidence as invalid state", () => {
    const { builder, input } = fixture();
    input.messages = [{ role: "tool", toolCallId: "missing", content: "{}" }];
    expect(() => builder.build(input)).toThrow("QA execution transcript");
    input.messages = [];
    input.decision = { informationNeeds: [], selectedEvidenceIds: ["forged"], externalEvidenceNeeded: [], insufficientEvidence: [], conclusion: "ready" };
    expect(() => builder.build(input)).toThrow("EVIDENCE_INVALID");
  });

  it("refuses expired or cancelled input without an observable model request", () => {
    const { builder, input, store } = fixture();
    input.deadline = Date.now() - 1;
    expect(() => builder.build(input)).toThrow("DEADLINE_EXCEEDED");
    const controller = new AbortController();
    controller.abort("USER_STOPPED");
    input.signal = controller.signal;
    expect(() => builder.build(input)).toThrow("USER_STOPPED");
    expect(store.phase).not.toHaveBeenCalled();
  });
});
