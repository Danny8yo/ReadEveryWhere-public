import { createQaReadingTools } from "./tools/qa-reading-tools";
import { createQaDeliveryTools } from "./tools/qa-delivery-tools";
import { QaToolRegistry } from "./tools/qa-tool-registry";
import { QA_POLICY } from "./selection-qa-runtime.port";
import { finishPlan, passingQualityFixture } from "./selection-qa-decision.fixture";
import { DeepSeekLanguageModelAdapter } from "../../../../integrations/deepseek/deepseek-language-model.adapter";
import { LanguageModelGateway } from "../../../../support/ai-model/application/language-model.gateway";
import { ProviderRegistry } from "../../../../support/ai-model/application/provider-registry";
import { ModelProfileRegistry } from "../../../../support/ai-model/application/model-profile";
import { PromptCachePolicyRegistry, AutomaticPrefixPromptCachePolicy } from "../../../../support/ai-model/application/prompt-cache-policy";
import { TokenEstimatorRegistry } from "../../../../support/ai-model/application/ports/token-estimator.port";
import { SelectionQaModelAdapter } from "../infrastructure/selection-qa-model.adapter";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { initializeSchema } from "../../../../platform/persistence/sqlite/schema-migrations";
import { seedUpgradeFixture } from "../../../../platform/persistence/sqlite/schema-upgrade.fixture";
import { SqliteService } from "../../../../platform/persistence/sqlite/sqlite.service";
import { SqliteSelectionQaRepository } from "../infrastructure/sqlite-selection-qa.repository";
import { SqliteSelectionQaRuntimeStore } from "../infrastructure/sqlite-selection-qa-runtime.store";
import { SelectionQaService } from "./selection-qa.service";
import { SelectionQaExecutor } from "./selection-qa.executor";
import { SelectionQaError, SelectionSnapshot } from "./selection-qa.types";
import {
  QaBookPort,
  QaClaim,
  QaModelPort,
  QaModelSnapshot,
  QaModelInput,
  QaEvidence,
} from "./selection-qa-runtime.port";
const snapshot: QaModelSnapshot = {
  version: 1,
  providerId: "test",
  modelId: "test",
  configUpdatedAt: null,
  tokenizerId: "test",
  contextWindowTokens: 64000,
  maxOutputTokens: 4096,
  policyVersion: QA_POLICY.version,
};
const selection: SelectionSnapshot = {
  scope: {
    bookId: 1,
    fileChecksum: "sha256:checksum",
    extractorVersion: "v1",
    normalizationVersion: "v1",
    sectionIndex: 0,
    href: "chapter.xhtml",
  },
  artifact: {
    bookId: 1,
    artifactId: "artifact",
    fileChecksum: "sha256:checksum",
  },
  source: { start: { path: [0], offset: 0 }, end: { path: [0], offset: 4 } },
  displayedQuote: "text",
  canonicalQuote: "text",
  start: 0,
  end: 4,
};
function evidence(s = selection): QaEvidence {
  return {
    locator: {
      version: 1,
      bookId: 1,
      contentRevision: {
        fileChecksum: s.scope.fileChecksum,
        extractorVersion: "v1",
        normalizationVersion: "v1",
      },
      position: {
        kind: "epub_text",
        sectionIndex: 0,
        start: s.start,
        end: s.end,
      },
    },
    quote: s.canonicalQuote,
    quoteHash: createHash("sha256").update(s.canonicalQuote).digest("hex"),
    displayedQuote: s.displayedQuote,
    sectionIndex: 0,
    href: "chapter.xhtml",
    start: s.start,
    end: s.end,
    cfi: "cfi",
  };
}
const usage = { promptTokens: 10, completionTokens: 10, totalTokens: 20, cacheReadInputTokens: 2, cacheWriteInputTokens: null, uncachedInputTokens: 8 };
const idFrom = (input: QaModelInput) =>
  JSON.parse(input.messages[input.messages.length - 1].content!)
    .VERIFIED_EVIDENCE[0].evidenceId as string;
const contextCall = { id: "selection-context", name: "read_selection_context", arguments: "{}" };
const withContext = (input: QaModelInput) => JSON.parse(input.messages[input.messages.length - 1].content!).VERIFIED_EVIDENCE.length === 0;
describe("selection QA bounded execution", () => {
  let db: DatabaseSync,
    records: SqliteSelectionQaRepository,
    store: SqliteSelectionQaRuntimeStore,
    service: SelectionQaService,
    model: QaModelPort,
    books: QaBookPort,
    executor: SelectionQaExecutor,
    current: boolean;
  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys=ON");
    initializeSchema(db);
    seedUpgradeFixture(db);
    const sqlite = { getDatabase: () => db } as SqliteService;
    records = new SqliteSelectionQaRepository(sqlite);
    current = true;
    const content = {
      resolve: async () => selection,
      assertCurrent: () => {
        if (!current) throw new SelectionQaError("CONTENT_VERSION_CHANGED");
      },
    };
    store = new SqliteSelectionQaRuntimeStore(sqlite, records, content);
    model = {
      snapshot: () => snapshot,
      count: (_s, text) => Math.ceil(text.length / 4),
      complete: jest.fn(async (_u, _s, input) => ({ toolCalls: withContext(input) ? [contextCall] : finishPlan(input), usage })),
      stream: jest.fn(async (_u, _s, input, onDelta) => {
        const selected = JSON.parse(input.messages[input.messages.length - 1].content!).VERIFIED_EVIDENCE;
        await onDelta(selected.length ? `Answer [[evidence:${idFrom(input)}]]` : "基于模型通用知识：Answer");
        return { usage, finishReason: "stop" };
      }),
    };
    books = {
      index: jest.fn(async () => ({ state: "ready" as const })),
      context: jest.fn(async (_u, s) => evidence(s)),
      searchCandidates: jest.fn(async () => ({
        state: "ready" as const,
        candidates: [evidence()],
        budgetLimited: false, contextTruncated: false, unavailable: [],
      })),
      expandSelected: jest.fn(async (_user, _selection, input) => {

      return { candidates: input.evidence, contextWindows: input.evidence.map(e => ({ sectionIndex: e.sectionIndex, start: e.start, end: e.end, hitRanges: [{ sectionIndex: e.sectionIndex, start: e.start, end: e.end }] })), contextTruncated: false };
    }),
    searchPool: jest.fn(async () => { throw new Error("unused"); }), verifyCandidates: jest.fn(async () => { throw new Error("unused"); }),
    replay: jest.fn(async (_u, _s, items) => items),
    };
    service = new SelectionQaService(
      records,
      content,
      {
        findReceipt: () => null,
        execute: async () => {
          throw new Error("unused");
        },
      },
      model,
    );
    executor = new SelectionQaExecutor(store, passingQualityFixture(model), books, { get: (_userId, bookId) => ({ bookId, title: "大型网站技术架构" }) }, env => new QaToolRegistry([...createQaReadingTools(env), ...createQaDeliveryTools(env.ledger, env.currentBook)]));
  });
  afterEach(() => db.close());
  async function claim() {
    await service.create(1, {
      commandId: "create",
      bookId: 1,
      selection,
      question: "Explain",
    });
    return store.claim("owner", Date.now())!;
  }
  async function run(c: QaClaim) {
    await executor.run(c, new AbortController().signal);
    return records.turn(1, c.turn.id);
  }
  it("accepts selected verified candidates without imposing an automatic expansion-stage budget", async () => {
    const candidates = Array.from({ length: 16 }, (_, index) => {
      const quote = `候选片段${index}`;
      return evidence({ ...selection, start: 100 + index * 20, end: 100 + index * 20 + quote.length, canonicalQuote: quote, displayedQuote: quote });
    });
    books.searchCandidates = jest.fn(async () => ({ state: "ready" as const, candidates, budgetLimited: false, contextTruncated: false, unavailable: [] }));
    let planningStep = 0;
    model.complete = jest.fn(async (_userId, _snapshot, input) => {
      planningStep++;
      if (planningStep === 1) return { usage, toolCalls: [{ id: "search", name: "search_book", arguments: JSON.stringify({ informationNeed: "比较检索方案", queries: { query1: "检索", query2: "", query3: "", query4: "" } }) }] };
      const envelope = JSON.parse(input.messages[input.messages.length - 1].content!);
      const candidateIds = envelope.VERIFIED_EVIDENCE.map((item: { evidenceId: string }) => item.evidenceId) as string[];
      return { usage, toolCalls: [{ id: `finish-${planningStep}`, name: "finish_research", arguments: JSON.stringify({
        informationNeeds: candidateIds.map((id: string, index: number) => ({ text: `比较检索方案的证据${index + 1}`, targetSource: "current_book", sourceName: "", evidenceIds: [id] })),
        externalEvidenceNeeded: [], insufficientEvidence: [], conclusion: "已有足够片段",
      }) }] };
    });
    const turn = await run(await claim());
    expect(turn?.status).toBe("completed");
    expect(planningStep).toBe(2);
    const review = turn?.process?.find(step => step.detail.operation === "finish_research" && step.detail.state === "completed")!.detail;
    expect(review?.selectedEvidenceIds).toHaveLength(16);
    expect(books.expandSelected).not.toHaveBeenCalled();
    expect(turn?.process?.some(step => step.detail.operation === "finish_research" && step.detail.state === "failed")).toBe(false);
  });
  it("returns validation feedback for malformed finish_research fields before the final planning call", async () => {
    let planningStep = 0;
    model.complete = jest.fn(async (_userId, _snapshot, input) => {
      planningStep++;
      if (planningStep === 1) return { usage, toolCalls: [{ id: "invalid", name: "finish_research", arguments: JSON.stringify({ informationNeeds: [], selectedEvidenceIds: [] }) }] };
      const feedback = JSON.parse([...input.messages].reverse().find(message => message.role === "tool")!.content!);
      expect(feedback.validation).toMatchObject({ field: "finish_research", constraint: "exactly the four required decision fields" });
      return { usage, toolCalls: finishPlan(input) };
    });
    const turn = await run(await claim());
    expect(turn?.status).toBe("completed");
    expect(planningStep).toBe(2);
  });
  it("fails explicitly when a decision invents an evidence ID", async () => {
    let planningStep = 0;
    model.complete = jest.fn(async (_userId, _snapshot, input) => {
      planningStep++;
      const call = finishPlan(input)[0];
      if (planningStep === 1) {
        const raw = JSON.parse(call.arguments);
        raw.informationNeeds = [{ text: "解释本书", targetSource: "current_book", sourceName: "", evidenceIds: ["e_invented"] }];
        call.arguments = JSON.stringify(raw);
      }
      return { usage, toolCalls: [call] };
    });
    const turn = await run(await claim());
    expect(turn).toMatchObject({ status: "failed", errorCode: "EVIDENCE_INVALID" });
    expect(planningStep).toBe(1);
    expect(model.stream).not.toHaveBeenCalled();
  });
  it("executes two book calls from one planning response within the turn search budget", async () => {
    let planningStep = 0;
    model.complete = jest.fn(async (_userId, _snapshot, input) => {
      if (++planningStep === 1) return { usage, toolCalls: ["索引", "范围"].map((query, index) => ({
        id: `search-${index}`, name: "search_book", arguments: JSON.stringify({ informationNeed: query, queries: { query1: query, query2: "", query3: "", query4: "" } }),
      })) };
      return { usage, toolCalls: finishPlan(input) };
    });
    const turn = await run(await claim());
    expect(turn?.status).toBe("completed");
    expect(books.searchCandidates).toHaveBeenCalledTimes(2);
    expect(turn?.process?.filter(step => step.detail.operation === "search_book" && step.detail.state === "completed")).toHaveLength(2);
  });
  it("keeps the current book distinct from a named second book across a general answer and follow-up", async () => {
    const firstQuestion = "我记得mysql默认用的b-tree吧，为什么数据库多采用b+树？";
    const secondQuestion = "那为啥教科书里InnoDB默认索引都用B树？《高性能MySQL》也是这么写的。";
    const candidates = Array.from({ length: 20 }, (_, n) => {
      const quote = `索引结构片段${n}`;
      return evidence({ ...selection, start: 100 + n * 100, end: 100 + n * 100 + quote.length, canonicalQuote: quote, displayedQuote: quote });
    });
    const relevantQuote = "B+树适合范围检索";
    const relevant = evidence({ ...selection, start: 3000, end: 3000 + relevantQuote.length, canonicalQuote: relevantQuote, displayedQuote: relevantQuote });
    let searchNumber = 0;
    books.searchCandidates = jest.fn(async () => ({ state: "ready" as const, candidates: ++searchNumber === 1 ? candidates : [relevant], budgetLimited: false, contextTruncated: false, unavailable: [] }));
    await service.create(1, { commandId: "first", bookId: 1, selection, question: firstQuestion });
    let planningStep = 0;
    model.complete = jest.fn(async (_u, _s, input) => {
      if (++planningStep === 1) return { usage, toolCalls: [{ id: "first-search", name: "search_book", arguments: JSON.stringify({ informationNeed: "索引结构", queries: { query1: "B树 B+树", query2: "", query3: "", query4: "" } }) }] };
      const call = finishPlan(input)[0];
      const decision = JSON.parse(call.arguments);
      decision.informationNeeds = [{ text: "解释B树与B+树的概念", targetSource: "model_knowledge", sourceName: "", evidenceIds: [] }];
      call.arguments = JSON.stringify(decision);
      return { usage, toolCalls: [call] };
    });
    model.stream = jest.fn(async (_u, _s, _input, delta) => { await delta("基于模型通用知识：首轮内部知识句子。"); return { usage, finishReason: "stop" }; });
    const first = store.claim("owner", Date.now())!;
    expect((await run(first)).status).toBe("completed");

    service.addTurn(1, first.conversation.id, { commandId: "followup", question: secondQuestion });
    planningStep = 0;
    model.complete = jest.fn(async (_u, _s, input) => {
      const history = JSON.parse(input.messages.find(m => m.content?.includes('"contextType":"conversation_history"'))!.content!);
      expect(history.sourceBook).toEqual({ bookId: 1, title: "大型网站技术架构" });
      expect(history.recentTurns[0]).toMatchObject({ question: firstQuestion, answerProvenance: "prior_model_output_not_source_evidence" });
      expect(history.priorSearches[0]).toMatchObject({ resultCount: 20, selectedCandidateCount: 0 });
      const envelope = JSON.parse(input.messages[input.messages.length - 1].content!);
      expect(envelope.CURRENT_BOOK.title).toBe("大型网站技术架构");
      if (++planningStep === 1) return { usage, toolCalls: [{ id: "second-search", name: "search_book", arguments: JSON.stringify({ informationNeed: "本书的索引结构论述", queries: { query1: "索引 B+树", query2: "", query3: "", query4: "" } }) }] };
      expect(envelope.VERIFIED_EVIDENCE[0].sourceBook.title).toBe("大型网站技术架构");
      const call = finishPlan(input)[0];
      const decision = JSON.parse(call.arguments);
      decision.informationNeeds.push(
        { text: "解释B树和B+树的术语差异", targetSource: "model_knowledge", sourceName: "", evidenceIds: [] },
        { text: "用户提到的另一册书的原文", targetSource: "other_book_unverified", sourceName: "高性能MySQL", evidenceIds: [] },
      );
      call.arguments = JSON.stringify(decision);
      return { usage, toolCalls: [call] };
    });
    model.stream = jest.fn(async (_u, _s, input, delta) => {
      expect(JSON.stringify(input.messages)).toContain("首轮内部知识句子");
      expect(JSON.stringify(input.messages)).toContain("prior_model_output_not_source_evidence");
      const envelope = JSON.parse(input.messages[input.messages.length - 1].content!);
      expect(envelope.RESEARCH_DECISION.informationNeeds).toEqual(expect.arrayContaining([
        expect.objectContaining({ targetSource: "other_book_unverified", sourceName: "高性能MySQL", evidenceIds: [] }),
        expect.objectContaining({ targetSource: "current_book", evidenceIds: ["s1"] }),
      ]));
      expect(envelope.VERIFIED_EVIDENCE[0]).toMatchObject({ evidenceId: "s1", sourceBook: { bookId: 1, title: "大型网站技术架构" }, quote: relevantQuote });
      await delta("《大型网站技术架构》的相关片段说明范围检索。[[evidence:s1]] 基于模型通用知识，B-Tree有时用作索引类型的宽泛称呼。");
      return { usage, finishReason: "stop" };
    });
    const second = store.claim("owner", Date.now())!;
    const turn = await run(second);
    expect(turn.status).toBe("completed");
    expect(turn.citations).toHaveLength(1);
    expect(turn.citations[0].quote).toBe(relevantQuote);
  });
  it.each([false, true])("passes search failure diagnostics to final input (recovered=%s)", async recovered => {
    let round = 0;
    model.complete = jest.fn(async (_u, _s, input) => {
      round++;
      if (round === 3) return { usage, toolCalls: finishPlan(input) };
      return { usage, toolCalls: [{ id: `search-${round}`, name: "search_book", arguments: JSON.stringify({ informationNeed: "概念", queries: { query1: round === 2 && recovered ? "临时表" : "x".repeat(129), query2: "", query3: "", query4: "" } }) }] };
    });
    const c = await claim();
    const turn = await run(c);
    expect(turn.status).toBe("completed");
    expect(books.searchCandidates).toHaveBeenCalledTimes(recovered ? 1 : 0);
    expect(model.complete).toHaveBeenCalledTimes(3);
    const failed = turn.process!.filter(p => p.detail.operation === "search_book" && p.detail.state === "failed");
    expect(failed).toHaveLength(recovered ? 1 : 2);
    expect(turn.errorCode).toBeNull();
    expect(failed[0].detail.validation).toEqual({ field: "queries.query1", constraint: "length", actual: 129, minimum: 1, maximum: 128 });
    const repair = (model.complete as jest.Mock).mock.calls[1][2].messages.find((m: any) => m.role === "tool");
    expect(JSON.parse(repair.content).validation).toEqual(failed[0].detail.validation);
    const input = (model.stream as jest.Mock).mock.calls[0][2];
    const final = JSON.parse(input.messages.at(-1).content);
    expect(final.SEARCH_OUTCOME).toEqual({ succeeded: recovered ? 1 : 0, failed: recovered ? 1 : 2 });
    expect(final.researchStatusInstruction).toContain(recovered ? "Some book search operations failed and others completed" : "none completed successfully");
    expect(input.messages[0].content).toContain("Empty or failed searches do not prove whole-book absence");
    expect(turn.process!.find(p => p.detail.operation === "stream" && p.detail.state === "started")!.detail.researchLimited).toBe(true);
  });
  it("does not describe an intentional no-search decision as a failed search", async () => {
    const turn = await run(await claim());
    expect(turn.status).toBe("completed");
    expect(books.searchCandidates).not.toHaveBeenCalled();
    const final = JSON.parse((model.stream as jest.Mock).mock.calls[0][2].messages.at(-1).content);
    expect(final.SEARCH_OUTCOME).toEqual({ succeeded: 0, failed: 0 });
    expect(final.researchStatusInstruction).toContain("No new book search was executed");
    expect(final.researchStatusInstruction).not.toContain("Disclose the partial failure");
    expect(final.researchStatusInstruction).not.toContain("If failed > 0");
  });
  it("notifies only committed events, suppresses rollback, isolates users and unsubscribes", async () => {
    const c = await claim();
    await Promise.resolve();
    const seen: string[] = [];
    const stop = records.subscribe(1, c.turn.id, () => {
      expect(db.isTransaction).toBe(false);
      seen.push(records.turn(1, c.turn.id).answer);
    });
    const other = jest.fn();
    const stopOther = records.subscribe(2, c.turn.id, other);
    store.append(c, "first", []);
    expect(seen).toEqual([]);
    await Promise.resolve();
    expect(seen).toEqual(["first"]);
    expect(other).not.toHaveBeenCalled();
    expect(() => records.transact(() => {
      records.eventsChanged(1, c.turn.id);
      throw new Error("rollback");
    })).toThrow("rollback");
    await Promise.resolve();
    expect(seen).toEqual(["first"]);
    stop(); stopOther();
    store.append(c, "second", []);
    await Promise.resolve();
    expect(seen).toEqual(["first"]);
  });
  it("keeps tool decision separate from the public answer and correlates model calls", async () => {
    const c = await claim();
    await run(c);
    const plan = (model.complete as jest.Mock).mock.calls[0][2] as QaModelInput;
    const answer = (model.stream as jest.Mock).mock.calls[0][2] as QaModelInput;
    expect(plan.turnId).toBe(c.turn.id);
    expect(plan.messages[0].content).toContain("This response chooses actions; it is not the public answer");
    expect(answer.messages.some(m => m.content?.includes("This request is ONLY"))).toBe(false);
    expect(answer.turnId).toBe(c.turn.id);
    const restored = records.turn(1, c.turn.id);
    expect(restored.process).toEqual(expect.arrayContaining([
      expect.objectContaining({ detail: expect.objectContaining({ operation: 'model', state: 'completed', elapsedMs: expect.any(Number) }) }),
      expect.objectContaining({ detail: expect.objectContaining({ operation: 'stream', state: 'completed', deltaCount: expect.any(Number), firstDeltaMs: expect.any(Number) }) }),
    ]));
  });
  it.each(["read_book", "book_read"])("does not expose or execute removed reading tool %s", async (name) => {
    model.complete = jest.fn(async (_u, _s, input) => {
      if (!input.tools) throw new Error("Planning tools missing");
      expect(input.tools.map((t: any) => t.function.name)).toEqual(expect.arrayContaining(["finish_research", "search_book", "read_selection_context", "expand_evidence", "request_clarification"]));
      expect(input.tools.some(t => t.function.name === name)).toBe(false);
      return { usage, toolCalls: [{ id: "removed-read", name, arguments: "{}" }] };
    });
    const c = await claim();
    const result = await run(c);
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("TOOL_NOT_ALLOWED");
    expect(books.context).not.toHaveBeenCalled();
    expect(books.searchCandidates).not.toHaveBeenCalled();
    expect(model.stream).not.toHaveBeenCalled();
  });
  it.each([false, true])("uses actual DeepSeek HTTP/SSE normalization with reasoning=%s", async reasoning => {
    const fetchFn = jest.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body));
      const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, prompt_cache_hit_tokens: 2, prompt_cache_miss_tokens: 8 };
      if (!body.stream && body.tools.some((t: any) => t.function.name === "assess_answer"))
        return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "check", type: "function", function: { name: "assess_answer", arguments: '{"verdict":"pass","issues":[]}' } }] }, finish_reason: "tool_calls" }], usage }));
      if (!body.stream) {
        expect(body.tool_choice).toBe(reasoning ? "auto" : "required");
        const searchSchema = body.tools.find((t: any) => t.function.name === "search_book")?.function.parameters;
        if (searchSchema) {
          expect(searchSchema.required).toEqual(["informationNeed", "queries"]);
          expect(searchSchema.properties.limit).toBeUndefined();
          expect(searchSchema.properties.queries.type).toBe("object");
          expect(searchSchema.properties.queries.required).toEqual(["query1", "query2", "query3", "query4"]);
          expect(searchSchema.properties.queries.additionalProperties).toBe(false);
        }

        const prior = body.messages.find((m: any) => m.role === "assistant");
        if (prior) {
          expect(prior.reasoning_content).toBe("opaque-test-continuation");
          const at = body.messages.indexOf(prior);
          expect(body.messages[at + 1].role).toBe("tool");
          expect(body.messages[at + 1].tool_call_id).toBe("call-1");
        }
        return new Response(JSON.stringify({ id: "test", model: "deepseek-chat", choices: [{ message: { role: "assistant", content: "ready", reasoning_content: "opaque-test-continuation", ...(!prior ? { tool_calls: [{ id: "call-1", type: "function", function: { name: "search_book", arguments: JSON.stringify({ informationNeed: "解释本书概念", queries: { query1: "text", query2: "", query3: "", query4: "" } }) } }] } : { tool_calls: finishPlan({ messages: body.messages }).map(c => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })) }) }, finish_reason: prior ? "stop" : "tool_calls" }], usage }));
      }
      expect(body.tool_choice).toBeUndefined();
      expect(body.tools).toBeUndefined();
      return new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: `真实适配器协议测试 [[evidence:${idFrom({ messages: body.messages } as QaModelInput)}]]` }, finish_reason: null }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage }) + '\n\ndata: [DONE]\n\n');
    });
    const profiles = new ModelProfileRegistry([{ providerId: "deepseek", resolve: modelId => ({ providerId: "deepseek", modelId, capabilities: { tools: true, strictTools: true, streaming: true, reasoning, reasoningWithTools: reasoning, contextWindowTokens: 64000, maxOutputTokens: 4096, tokenizerId: "test", cachePolicyId: "automatic-prefix" } }) }]);
    const tokenizers = new TokenEstimatorRegistry([{ tokenizerId: "test", encode: value => [...value].map(c => c.codePointAt(0)!), count: value => [...value].length }]);
    const gateway = new LanguageModelGateway(new ProviderRegistry([new DeepSeekLanguageModelAdapter(fetchFn)]), profiles, new PromptCachePolicyRegistry([new AutomaticPrefixPromptCachePolicy()]), tokenizers);
    const adapter = new SelectionQaModelAdapter(gateway, { getPublic: () => ({ provider: "deepseek", displayName: "test", modelId: "deepseek-chat", hasApiKey: true, updatedAt: null }), getCredential: () => ({ provider: "deepseek", modelId: "deepseek-chat", apiKey: "isolated-test-only" }) } as any, profiles, tokenizers);
    books.searchCandidates = jest.fn(async () => ({ state: "ready" as const, candidates: [evidence()], budgetLimited: false, contextTruncated: false, unavailable: [{ sectionIndex: 0, href: "chapter.xhtml", start: 4, end: 5, reason: "SYNTHETIC_EDGE" }] }));
    const c = await claim(); c.snapshot = adapter.snapshot(1);
    await new SelectionQaExecutor(store, adapter, books, { get: (_userId, bookId) => ({ bookId, title: "大型网站技术架构" }) }, env => new QaToolRegistry([...createQaReadingTools(env), ...createQaDeliveryTools(env.ledger, env.currentBook)])).run(c, new AbortController().signal);
    expect(records.turn(1, c.turn.id)).toMatchObject({ status: "completed", answer: expect.stringContaining("真实适配器协议测试 [[evidence:") });
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });
  it("discloses complete context and retrieved text and restores old previews from the same turn ledger", async () => {
    const text = 'text' + '完整原文'.repeat(350) + '片段末尾';
    const full = evidence({ ...selection, canonicalQuote: text, displayedQuote: text, end: text.length });
    books.context = jest.fn(async () => full);
    books.searchCandidates = jest.fn(async () => ({ state: 'ready' as const, candidates: [full], budgetLimited: false, contextTruncated: false, unavailable: [] }));
    let plans = 0;
    model.complete = jest.fn(async (_u, _s, input) => ({ usage, toolCalls: plans++ === 0 ? [contextCall, { id: 'search', name: 'search_book', arguments: JSON.stringify({ informationNeed: "解释本书概念", queries: { query1: '原文', query2: "", query3: "", query4: "" } }) }] : finishPlan(input) }));
    const c = await claim();
    const turn = await run(c);
    expect(turn.status).toBe('completed');
    for (const operation of ['selection_context', 'search_book']) {
      const step = turn.process!.find(p => p.detail.operation === operation && p.detail.state === 'completed')!;
      expect(step.detail.results).toEqual([expect.objectContaining({ text })]);
    }
    const stream = turn.process!.find(p => p.detail.operation === 'stream' && p.detail.state === 'started')!;
    expect(stream.detail).toMatchObject({ modelId: 'test', evidenceCount: 1, evidenceChars: text.length });
    const search = turn.process!.find(p => p.detail.operation === 'search_book' && p.detail.state === 'completed')!;
    db.prepare('UPDATE selection_qa_events SET payload_json=? WHERE turn_id=? AND sequence=?').run(JSON.stringify({ ...search.detail, results: [{ href: full.href, sectionIndex: 0, start: 0, end: text.length, excerpt: text.slice(0, 300), truncated: true }] }), c.turn.id, search.sequence);
    const restored = records.turn(1, c.turn.id).process!.find(p => p.sequence === search.sequence)!;
    expect(restored.detail.results).toEqual([expect.objectContaining({ text })]);
  });
  it("streams a verified citation and atomically stores answer and terminal sequence", async () => {
    const c = await claim();
    const turn = await run(c);
    expect(turn.status).toBe("completed");
    expect(turn.citations).toHaveLength(1);
    expect(turn.citations[0].quote).toBe("text");
    expect(turn.phase).toBe("terminal");
    expect(turn.answer).toContain("[[evidence:e_");
    expect(
      records.events(1, c.turn.id, 0).filter((e) => e.kind === "citation"),
    ).toHaveLength(1);
    expect(store.remaining(c)).toEqual({ models: QA_POLICY.maxModelCalls - 4, tools: QA_POLICY.maxToolCalls - 1, chars: QA_POLICY.maxReadChars - 4 });
  });
  it("rejects actual serialized input above token cap before any provider call", async () => {
    model.count = jest.fn(() => snapshot.contextWindowTokens);
    const turn = await run(await claim());
    expect(turn.errorCode).toBe("INPUT_TOKEN_LIMIT");
    expect(model.complete).not.toHaveBeenCalled();
    expect(model.stream).not.toHaveBeenCalled();
    expect(model.count).toHaveBeenCalledWith(
      snapshot,
      expect.stringContaining("VERIFIED_EVIDENCE"),
    );
  });
  it.each([64000, 15000])("keeps full older turns when they fit and removes oldest turns near a %i-token window", async (window) => {
    await service.create(1, { commandId: "history-first", bookId: 1, selection, question: "第一轮问题" });
    const first = store.claim("owner", Date.now())!;
    const conversationId = first.conversation.id;
    for (let index = 1; index <= 4; index++) {
      const current = index === 1 ? first : store.claim("owner", Date.now())!;
      store.append(current, `第${index}轮完整回答：` + "内容".repeat(4000), []);
      store.finish(current, "failed", "historical_fixture");
      db.prepare("UPDATE selection_qa_turns SET status='completed',error_code=NULL WHERE id=?").run(current.turn.id);
      service.addTurn(1, conversationId, { commandId: `history-${index}`, question: `第${index + 1}轮问题` });
    }
    model.snapshot = () => ({ ...snapshot, contextWindowTokens: window });
    // The queued fifth turn keeps its original snapshot; change only that persisted snapshot for this isolated fixture.
    db.prepare("UPDATE selection_qa_turns SET model_snapshot_json=? WHERE conversation_id=? AND turn_number=5").run(JSON.stringify(model.snapshot(1)), conversationId);
    model.stream = jest.fn(async (_u, _s, _input, delta) => { await delta("基于模型通用知识：回答。"); return { usage, finishReason: "stop" }; });
    model.complete = jest.fn(async (_u, _s, input) => ({ usage, toolCalls: finishPlan(input) }));
    const current = store.claim("owner", Date.now())!;
    expect((await run(current)).status).toBe("completed");
    const planning = (model.complete as jest.Mock).mock.calls[0][2] as QaModelInput;
    const history = JSON.parse(planning.messages.find(message => message.content?.startsWith('{"contextType":"conversation_history",'))!.content!);
    const event = records.turn(1, current.turn.id).process!.find(step => step.detail.operation === "context_usage" && step.detail.callKind === "planning")!;
    expect(event.detail.estimatedInputTokens).toBeLessThanOrEqual(window - 3072 - 1024);
    expect(records.turn(1, current.turn.id).process).toEqual(expect.arrayContaining([
      expect.objectContaining({ detail: expect.objectContaining({ operation: "model", state: "completed", promptTokens: usage.promptTokens }) }),
      expect.objectContaining({ detail: expect.objectContaining({ operation: "stream", state: "completed", promptTokens: usage.promptTokens }) }),
    ]));
    if (window === 64000) {
      expect(history.recentTurns).toHaveLength(4);
      expect(history.recentTurns[0].answer).toContain("内容".repeat(4000));
      expect(event.detail.omittedTurns).toBe(0);
    } else {
      expect(history.recentTurns.length).toBeLessThan(4);
      expect(history.recentTurns.at(-1).question).toBe("第4轮问题");
      expect(event.detail.omittedTurns).toBeGreaterThan(0);
    }
    const final = (model.stream as jest.Mock).mock.calls[0][2] as QaModelInput;
    const finalHistory = JSON.parse(final.messages.find(message => message.content?.startsWith('{"contextType":"conversation_history",'))!.content!);
    expect(JSON.stringify(finalHistory)).toContain("第4轮完整回答");
    expect(finalHistory.recentTurns.at(-1).answerProvenance).toBe("prior_model_output_not_source_evidence");
  });
  it("reserves final stream after two searches and a final evidence review", async () => {
    let rounds = 0;
    model.complete = jest.fn(async (_u, _s, input) => ({
      toolCalls: ++rounds < 3 ? [{ id: "search" + rounds, name: "search_book", arguments: JSON.stringify({ informationNeed: "解释概念", queries: { query1: "text" + rounds, query2: "", query3: "", query4: "" } }) }] : finishPlan(input), usage,
    }));
    const c = await claim();
    expect((await run(c)).status).toBe("completed");
    expect(model.complete).toHaveBeenCalledTimes(3);
    expect(model.stream).toHaveBeenCalledTimes(1);
    expect(books.searchCandidates).toHaveBeenCalledTimes(2);
    expect((model.complete as jest.Mock).mock.calls[2][2].tools.map((t: any) => t.function.name)).toEqual(expect.arrayContaining(["finish_research", "search_book", "expand_evidence"]));
    expect(store.remaining(c).models).toBe(QA_POLICY.maxModelCalls - 5);
  });
  it("keeps the final stream reserved after two searches and two finish_research repairs", async () => {
    let round = 0;
    model.complete = jest.fn(async (_u, _s, input) => {
      round++;
      if (round <= 2) return {
        usage,
        toolCalls: [{ id: `search-${round}`, name: "search_book", arguments: JSON.stringify({ informationNeed: `解释概念${round}`, queries: { query1: `text${round}`, query2: "", query3: "", query4: "" } }) }],
      };
      if (round <= 4) return {
        usage,
        toolCalls: [{ id: `invalid-finish-${round}`, name: "finish_research", arguments: JSON.stringify({ informationNeeds: [], selectedEvidenceIds: [] }) }],
      };
      expect(input.tools?.map((tool: any) => tool.function.name)).toEqual(expect.arrayContaining(["finish_research", "search_book"]));
      return { usage, toolCalls: finishPlan(input) };
    });
    const c = await claim();
    const turn = await run(c);
    expect(turn.status).toBe("completed");
    expect(model.complete).toHaveBeenCalledTimes(5);
    expect(model.stream).toHaveBeenCalledTimes(1);
    expect(store.remaining(c).models).toBe(QA_POLICY.maxModelCalls - 7);
    expect(turn.process!.filter(step => step.detail.operation === "finish_research" && step.detail.state === "failed")).toHaveLength(2);
    expect(turn.process!.filter(step => step.detail.operation === "model" && step.detail.state === "completed")).toHaveLength(5);
  });
  it("discloses incomplete initial context boundaries to planning and final answering", async () => {
    books.context = jest.fn(async () => ({...evidence(),contextTruncated:true}));
    const c = await claim();
    expect((await run(c)).status).toBe("completed");
    const planning = (model.complete as jest.Mock).mock.calls[1][2] as QaModelInput;
    const answering = (model.stream as jest.Mock).mock.calls[0][2] as QaModelInput;
    for (const input of [planning, answering])
      expect(input.messages.some(m => m.content?.includes('"contextTruncated":true'))).toBe(true);
  });
  it("keeps valid 12000-character original selections complete", async () => {
    const long = {
      ...selection,
      canonicalQuote: "x".repeat(12000),
      displayedQuote: "x".repeat(12000),
      end: 12000,
    };
    await service.create(1, {
      commandId: "create",
      bookId: 1,
      selection: long,
      question: "Explain",
    });
    db.prepare("UPDATE selection_qa_conversations SET selection_json=?").run(
      JSON.stringify(long),
    );
    const c = store.claim("owner", Date.now())!;
    expect((await run(c)).status).toBe("completed");
    expect(books.context).toHaveBeenCalledWith(
      1,
      long,
      expect.objectContaining({ maxChars: 12000 }),
    );
    expect(store.remaining(c).chars).toBe(QA_POLICY.maxReadChars - 12000);
  });
  it("accepts split and repeated legitimate citation markers only once", async () => {
    model.stream = async (_u, _s, input, delta) => {
      for (const char of `A [[evidence:${idFrom(input)}]] and [[evidence:${idFrom(input)}]]`)
        await delta(char);
      return { usage, finishReason: "stop" };
    };
    const c = await claim();
    expect((await run(c)).status).toBe("completed");
    expect(
      records.events(1, c.turn.id, 0).filter((e) => e.kind === "citation"),
    ).toHaveLength(1);
  });
  it.each(["[[evidence:forged]]", "[[evidence:unfinished"])(
    "rejects invalid citation %s and retains earlier partial text",
    async (marker) => {
      model.stream = async (_u, _s, _input, delta) => {
        await delta("Partial answer. ");
        await delta(marker);
        return { usage, finishReason: "stop" };
      };
      const c = await claim();
      const turn = await run(c);
      expect(turn.status).toBe("failed");
      expect(turn.answer).toBe("Partial answer. ");
      expect(turn.errorCode).toBe("CITATION_INVALID");
    },
  );
  it.each([null, "length", "content_filter"])(
    "does not treat finishReason %s as completed",
    async (finishReason) => {
      model.stream = async (_u, _s, _input, delta) => {
        await delta("partial");
        return { usage, finishReason };
      };
      const c = await claim();
      const turn = await run(c);
      expect(turn.status).toBe("failed");
      expect(turn.answer).toBe("partial");
    },
  );
  it("rejects output beyond the independent 64000 UTF16 limit", async () => {
    model.stream = async (_u, _s, _input, delta) => {
      await delta("partial");
      await delta("x".repeat(64000));
      return { usage, finishReason: "stop" };
    };
    const c = await claim();
    const turn = await run(c);
    expect(turn.errorCode).toBe("OUTPUT_CHARACTER_LIMIT");
    expect(turn.answer).toBe("partial");
  });
  it("stops and rejects late deltas without overwriting cancelled status", async () => {
    let c: QaClaim;
    model.stream = async (_u, _s, _input, delta) => {
      await delta("partial");
      service.stop(1, c.turn.id);
      await delta("late");
      return { usage, finishReason: "stop" };
    };
    c = await claim();
    const turn = await run(c);
    expect(turn.status).toBe("cancelled");
    expect(turn.answer).toBe("partial");
  });
  it("fences artifact replacement during a stream", async () => {
    model.stream = async (_u, _s, _input, delta) => {
      await delta("partial");
      current = false;
      await delta("late");
      return { usage, finishReason: "stop" };
    };
    const c = await claim();
    const turn = await run(c);
    expect(turn.status).toBe("failed");
    expect(turn.errorCode).toBe("CONTENT_VERSION_CHANGED");
    expect(turn.answer).toBe("partial");
    expect(records.conversation(1, c.conversation.id).status).toBe("frozen");
  });
  it("marks expired running leases interrupted without another provider call", async () => {
    const c = await claim();
    db.prepare(
      "UPDATE selection_qa_turns SET lease_expires_at=0 WHERE id=?",
    ).run(c.turn.id);
    store.maintain(Date.now());
    expect(records.turn(1, c.turn.id).errorCode).toBe("worker_interrupted");
    expect(store.claim("new-owner", Date.now())).toBeNull();
    expect(model.complete).not.toHaveBeenCalled();
  });
  it("enforces a changed persisted deadline on the next delta", async () => {
    let c: QaClaim;
    model.stream = async (_u, _s, _input, delta) => {
      await delta("partial");
      db.prepare("UPDATE selection_qa_turns SET deadline=0 WHERE id=?").run(
        c.turn.id,
      );
      await delta("late");
      return { usage, finishReason: "stop" };
    };
    c = await claim();
    const turn = await run(c);
    expect(turn.status).toBe("timed_out");
    expect(turn.answer).toBe("partial");
  });
  it("answers a general knowledge follow-up without reading selection/history or searching", async () => {
    const first = await claim();
    model.stream = jest.fn(async (_u, _s, input, delta) => { await delta(`上一轮专有措辞[[evidence:${idFrom(input)}]]`); return { usage, finishReason: "stop" }; });
    await run(first);
    jest.mocked(books.context).mockClear();
    service.addTurn(1, first.conversation.id, { commandId: "general", question: "基于通用知识解释 B 树与 B+ 树的区别" });
    model.complete = jest.fn(async (_u, _s, input) => {
      expect(JSON.parse(input.messages[input.messages.length - 1].content!).VERIFIED_EVIDENCE).toEqual([]);
      expect(input.tools!.some(t => t.function.name === "read_selection_context")).toBe(true);
      expect(JSON.stringify(input.messages)).toContain("上一轮专有措辞");
      return { usage, toolCalls: finishPlan(input) };
    });
    model.stream = jest.fn(async (_u, _s, input, delta) => {
      expect(JSON.parse(input.messages[input.messages.length - 1].content!).VERIFIED_EVIDENCE).toEqual([]);
      expect(JSON.stringify(input.messages)).toContain("上一轮专有措辞");
      expect(JSON.stringify(input.messages)).toContain("prior_model_output_not_source_evidence");
      await delta("基于模型通用知识：B+树的记录位于叶子节点，适合范围扫描。");
      return { usage, finishReason: "stop" };
    });
    const next = store.claim("owner", Date.now())!;
    expect((await run(next)).status).toBe("completed");
    expect(books.context).not.toHaveBeenCalled();
    expect(books.replay).not.toHaveBeenCalled();
    expect(books.searchCandidates).not.toHaveBeenCalled();
    expect(store.remaining(next)).toMatchObject({ tools: QA_POLICY.maxToolCalls, chars: QA_POLICY.maxReadChars, models: QA_POLICY.maxModelCalls - 3 });
  });
  it.each([false, true])("retains prior unsuccessful search observations while permitting another justified search (explicit=%s)", async retry => {
    const first = await claim();
    const queries = { query1: "B+树", query2: "B树", query3: "", query4: "" };
    const search = (name = "search_book") => [{ id: "search", name, arguments: JSON.stringify({ informationNeed: "索引差异", queries, ...(name === "repeat_book_search" ? { reason: "用户明确要求重新查找相同关键词" } : {}) }) }];
    let calls = 0;
    books.searchCandidates = jest.fn(async () => ({ state: "ready" as const, candidates: [], budgetLimited: false, contextTruncated: false, unavailable: [] }));
    model.complete = jest.fn(async (_u, _s, input) => {
      if (++calls === 1) return { usage, toolCalls: search() };
      const toolCalls = finishPlan(input);
      toolCalls[0].arguments = JSON.stringify({ ...JSON.parse(toolCalls[0].arguments), insufficientEvidence: ["当前片段不足"] });
      return { usage, toolCalls };
    });
    model.stream = jest.fn(async (_u, _s, _input, delta) => { await delta("当前取得的证据不足以确认；可进一步解释通用原理。"); return { usage, finishReason: "stop" }; });
    expect((await run(first)).status).toBe("completed");
    expect(books.searchCandidates).toHaveBeenCalledTimes(1);
    service.addTurn(1, first.conversation.id, { commandId: "next", question: retry ? "请按相同关键词重新查找" : "换个说法解释这个差异" });
    calls = 0;
    model.complete = jest.fn(async (_u, _s, input) => {
      const history = input.messages.find(m => m.content?.includes('"priorSearches":'))!;
      expect(JSON.parse(history.content!).priorSearches).toMatchObject([{ queries: ["B+树", "B树"], resultCount: 0, unresolved: true }]);
      if (++calls === 1) return { usage, toolCalls: search(retry ? "repeat_book_search" : "search_book") };
      return { usage, toolCalls: finishPlan(input) };
    });
    const next = store.claim("owner", Date.now())!;
    const turn = await run(next);
    expect(turn.status).toBe("completed");
    expect(books.searchCandidates).toHaveBeenCalledTimes(2);
    expect(books.replay).not.toHaveBeenCalled();
    expect(turn.process!.some(p => p.detail.operation === "search_book" && p.detail.state === "completed")).toBe(true);
  });
  it("replays historical evidence and assigns new turn-local IDs", async () => {
    const first = await claim();
    await run(first);
    service.addTurn(1, first.conversation.id, {
      commandId: "next",
      question: "More",
    });
    const next = store.claim("owner", Date.now())!;
    model.complete = jest.fn(async (_u, _s, input) => {
      const envelope = JSON.parse(input.messages[input.messages.length - 1].content!);
      return { usage, toolCalls: envelope.VERIFIED_EVIDENCE.length ? finishPlan(input) : [{ id: "history", name: "read_history_evidence", arguments: JSON.stringify({ evidenceIds: envelope.historicalEvidenceAvailable.map((item: { evidenceId: string }) => item.evidenceId) }) }] };
    });
    await run(next);
    expect(books.replay).toHaveBeenCalledTimes(1);
    const old = db
      .prepare("SELECT evidence_id FROM selection_qa_evidence WHERE turn_id=?")
      .get(first.turn.id)!.evidence_id;
    const fresh = db
      .prepare("SELECT evidence_id FROM selection_qa_evidence WHERE turn_id=?")
      .get(next.turn.id)!.evidence_id;
    expect(fresh).not.toBe(old);
    expect(store.remaining(next).tools).toBe(QA_POLICY.maxToolCalls - 1);
  });
  it("separates ACE allegations from SSD book queries and excludes irrelevant evidence from the final request", async () => {
    const c = await claim();
    c.turn.question = "你知道腾讯的ACE反作弊系统吗，他会损坏玩家的固态硬盘。听说是频繁读写，这个读写是SSD的I/O吗？";
    const relevant = evidence({ ...selection, start: 100, end: 109, canonicalQuote: "SSD的读写请求。", displayedQuote: "SSD的读写请求。" });
    books.searchCandidates = jest.fn(async () => ({ state: "ready" as const, candidates: [relevant], budgetLimited: false, contextTruncated: false, unavailable: [] }));
    let round = 0;
    model.complete = jest.fn(async (_u, _s, input) => {
      if (++round === 1) return { usage, toolCalls: [contextCall, { id: "ssd", name: "search_book", arguments: JSON.stringify({ informationNeed: "本书如何解释SSD的I/O", queries: { query1: "SSD 随机I/O", query2: "闪存 写放大", query3: "", query4: "" } }) }] };
      const call = finishPlan(input)[0];
      const decision = JSON.parse(call.arguments);
      decision.informationNeeds = [decision.informationNeeds[1]];
      decision.externalEvidenceNeeded = ["ACE是否频繁写盘并损坏SSD"];
      call.arguments = JSON.stringify(decision);
      return { usage, toolCalls: [call] };
    });
    model.stream = jest.fn(async (_u, _s, input, delta) => {
      const envelope = JSON.parse(input.messages[input.messages.length - 1].content!);
      expect(envelope.VERIFIED_EVIDENCE).toHaveLength(1);
      expect(envelope.VERIFIED_EVIDENCE[0].quote).toBe(relevant.quote);
      expect(envelope.RESEARCH_DECISION.externalEvidenceNeeded).toEqual(["ACE是否频繁写盘并损坏SSD"]);
      await delta(`一般概念与外部事实不同，ACE损坏SSD的说法无法核实。[[evidence:${idFrom(input)}]]`);
      return { usage, finishReason: "stop" };
    });
    const turn = await run(c);
    expect(turn.status).toBe("completed");
    expect(books.searchCandidates).toHaveBeenCalledWith(1, selection, expect.objectContaining({ queries: ["SSD 随机I/O", "闪存 写放大"] }));
    const review = turn.process!.find(p => p.detail.operation === "finish_research" && p.detail.state === "completed")!.detail;
    expect(review.rejectedEvidenceIds).toHaveLength(1);
    expect(review.selectedEvidenceIds).toHaveLength(1);
    expect(turn.citations.map(e => e.quote)).toEqual([relevant.quote]);
  });
  it.each([false, true])("expands rank 8 on request, observes its new context and rejects an unselected original citation (old=%s)", async (oldCitation) => {
    const candidates = Array.from({ length: 20 }, (_, index) => evidence({ ...selection, start: 100 + index * 100, end: 104 + index * 100 }));
    books.searchCandidates = jest.fn(async () => ({ state: "ready" as const, candidates, budgetLimited: false, contextTruncated: false, unavailable: [] }));
    const source = candidates[7];
    const expanded = evidence({ ...selection, start: source.start - 4, end: source.end + 4, canonicalQuote: "因果前文text后续解释", displayedQuote: "因果前文text后续解释" });
    books.expandSelected = jest.fn(async (_u, _s, input) => {
      expect(input.evidence).toEqual([expect.objectContaining(source)]);
      expect(input.maxWindowChars).toBe(1600);
      return { candidates: [expanded], contextWindows: [{ sectionIndex: 0, start: expanded.start, end: expanded.end, hitRanges: [{ sectionIndex: 0, start: source.start, end: source.end }] }], contextTruncated: false };
    });
    let round = 0, sourceId = "", finalId = "";
    model.complete = jest.fn(async (_u, _s, input) => {
      if (++round === 1) return { usage, toolCalls: [{ id: "search", name: "search_book", arguments: JSON.stringify({ informationNeed: "查明因果", queries: { query1: "因果", query2: "", query3: "", query4: "" } }) }] };
      const envelope = JSON.parse(input.messages[input.messages.length - 1].content!);
      if (round === 2) {
        expect(envelope.VERIFIED_EVIDENCE).toHaveLength(20);
        sourceId = envelope.VERIFIED_EVIDENCE[7].evidenceId;
        return { usage, toolCalls: [{ id: "expand", name: "expand_evidence", arguments: JSON.stringify({ evidenceIds: [sourceId], maxWindowChars: 1600 }) }] };
      }
      const expandedId = envelope.VERIFIED_EVIDENCE.find((item: { quote: string }) => item.quote === expanded.quote).evidenceId;
      const call = finishPlan(input)[0];
      const decision = JSON.parse(call.arguments);
      decision.informationNeeds = [{ text: "查明因果", targetSource: "current_book", sourceName: "", evidenceIds: [expandedId] }];
      call.arguments = JSON.stringify(decision);
      return { usage, toolCalls: [call] };
    });
    model.stream = jest.fn(async (_u, _s, input, delta) => {
      const envelope = JSON.parse(input.messages[input.messages.length - 1].content!);
      expect(envelope.VERIFIED_EVIDENCE).toHaveLength(1);
      finalId = envelope.VERIFIED_EVIDENCE[0].evidenceId;
      expect(finalId).not.toBe(sourceId);
      expect(envelope.VERIFIED_EVIDENCE[0].quote).toBe(expanded.quote);
      await delta(`因果解释。[[evidence:${oldCitation ? sourceId : finalId}]]`);
      return { usage, finishReason: "stop" };
    });
    const c = await claim(), turn = await run(c);
    expect(books.searchCandidates).toHaveBeenCalledWith(1, selection, expect.objectContaining({ limit: 20, maxChars: 12000 }));
    expect(books.expandSelected).toHaveBeenCalledTimes(1);
    expect(QA_POLICY.maxReadChars - store.remaining(c).chars).toBe(20 * 4 + expanded.quote.length);
    const expansion = turn.process!.find(p => p.detail.operation === "evidence_expansion" && p.detail.state === "completed")!;
    expect(finalId).toBe("s1");
    const savedId = (expansion.detail.results as any[])[0].evidenceId;
    expect(savedId).toMatch(/^e_[a-f0-9]{20}$/);
    expect(savedId).not.toBe(sourceId);
    expect(expansion.detail.results).toEqual([expect.objectContaining({ evidenceId: savedId, sourceEvidenceId: sourceId, text: expanded.quote })]);
    expect(turn.status).toBe(oldCitation ? "failed" : "completed");
    if (oldCitation) expect(turn.errorCode).toBe("CITATION_INVALID");
    else {
      expect(turn.citations).toEqual([expect.objectContaining({ evidenceId: savedId, quote: expanded.quote })]);
      expect(turn.answer).toContain(`[[evidence:${savedId}]]`);
      expect(turn.answer).not.toContain("[[evidence:s1]]");
    }
  });
  it("rejects an unknown short citation without guessing its source", async () => {
    model.stream = jest.fn(async (_u, _s, _input, delta) => {
      await delta("已保留文字。");
      await delta("[[evidence:s99]]");
      return { usage, finishReason: "stop" };
    });
    const turn = await run(await claim());
    expect(turn).toMatchObject({ status: "failed", errorCode: "CITATION_INVALID", answer: "已保留文字。" });
    expect(turn.citations).toEqual([]);
    expect(turn.process!.find(p => p.detail.operation === "citation_validation")!.detail).toMatchObject({ reason: "unknown_reference", reference: "s99" });
  });
  it("does not promote a planner's unsupported absence conclusion into final answer facts", async () => {
    model.complete = jest.fn(async (_u, _s, input) => {
      const call = finishPlan(input)[0];
      call.arguments = JSON.stringify({ ...JSON.parse(call.arguments), insufficientEvidence: ["书中没有任何产品案例"], conclusion: "全书未提供实测结论" });
      return { usage, toolCalls: [call] };
    });
    model.stream = jest.fn(async (_u, _s, input, delta) => {
      const serialized = JSON.stringify(input.messages);
      expect(serialized).toContain("model_identified_unverified_gaps");
      expect(serialized).not.toContain("全书未提供实测结论");
      const envelope = JSON.parse(input.messages[input.messages.length - 1].content!);
      expect(envelope.RESEARCH_DECISION.evidenceInsufficient).toBe(true);
      expect(envelope.RESEARCH_DECISION.insufficientEvidence).toEqual(["书中没有任何产品案例"]);
      expect(input.messages[0].content).toContain("They are not book facts or evidence of whole-book absence");
      expect(envelope.RESEARCH_DECISION).not.toHaveProperty("conclusion");
      await delta("就本次取得的片段，尚不能确认这一说法。");
      return { usage, finishReason: "stop" };
    });
    const turn = await run(await claim());
    expect(turn.status).toBe("completed");
    expect(turn.process!.find(p => p.detail.operation === "finish_research" && p.detail.state === "completed")!.detail.conclusion).toBe("全书未提供实测结论");
  });
  it("allows useful general explanation alongside book evidence without a blanket host refusal", async () => {
    model.complete = jest.fn(async (_u, _s, input) => {
      if (withContext(input)) return { usage, toolCalls: [contextCall] };
      const call = finishPlan(input)[0];
      call.arguments = JSON.stringify({ ...JSON.parse(call.arguments), externalEvidenceNeeded: ["具体产品实测结果"], insufficientEvidence: ["未取得外部实测"] });
      return { usage, toolCalls: [call] };
    });
    model.stream = jest.fn(async (_u, _s, input, delta) => {
      const envelope = JSON.parse(input.messages[input.messages.length - 1].content!);
      expect(input.messages[0].content).toContain("Keep useful conceptual explanations distinct");
      await delta("书内说明。[[evidence:s1]]");
      return { usage, finishReason: "stop" };
    });
    const turn = await run(await claim());
    expect(turn.status).toBe("completed");
    expect(turn.answer).not.toMatch(/^当前取得的书内片段不能核实/);
    expect(turn.citations).toHaveLength(1);
  });
  it("rejects empty output for external questions too", async () => {
    model.complete = jest.fn(async (_u, _s, input) => {
      const call = finishPlan(input)[0];
      call.arguments = JSON.stringify({ ...JSON.parse(call.arguments), externalEvidenceNeeded: ["外部实测"] });
      return { usage, toolCalls: [call] };
    });
    model.stream = jest.fn(async () => ({ usage, finishReason: "stop" }));
    const turn = await run(await claim());
    expect(turn).toMatchObject({ status: "failed", errorCode: "EMPTY_MODEL_ANSWER" });
    expect(turn.answer).not.toMatch(/^当前取得的书内片段不能核实/);
  });
  it("allows external-only questions to finish with no book citations and no search", async () => {
    model.complete = jest.fn(async (_u, _s, input) => {
      const call = finishPlan(input)[0];
      const decision = JSON.parse(call.arguments);
      decision.informationNeeds = [{ text: "解释SSD的I/O概念", targetSource: "model_knowledge", sourceName: "", evidenceIds: [] }];
      call.arguments = JSON.stringify({ ...decision, externalEvidenceNeeded: ["ACE是否损坏SSD"], conclusion: "缺少外部实测，无法核实" });
      return { usage, toolCalls: [call] };
    });
    model.stream = jest.fn(async (_u, _s, input, delta) => {
      expect(JSON.parse(input.messages[input.messages.length - 1].content!).VERIFIED_EVIDENCE).toEqual([]);
      await delta("没有外部证据，无法核实ACE是否损坏SSD。");
      return { usage, finishReason: "stop" };
    });
    expect((await run(await claim())).status).toBe("completed");
    expect(books.searchCandidates).not.toHaveBeenCalled();
    expect(model.complete).toHaveBeenCalledTimes(1);
  });
  it("rejects citations to candidates excluded by the planner", async () => {
    let excluded = "";
    model.complete = jest.fn(async (_u, _s, input) => {
      if (withContext(input)) return { usage, toolCalls: [contextCall] };
      excluded = idFrom(input);
      const call = finishPlan(input)[0];
      const decision = JSON.parse(call.arguments);
      decision.informationNeeds[0].evidenceIds = [];
      call.arguments = JSON.stringify({ ...decision, insufficientEvidence: ["选文不支持此问题"] });
      return { usage, toolCalls: [call] };
    });
    model.stream = jest.fn(async (_u, _s, _input, delta) => {
      await delta("保留前文。"); await delta(`[[evidence:${excluded}]]`);
      return { usage, finishReason: "stop" };
    });
    const turn = await run(await claim());
    expect(turn).toMatchObject({ status: "failed", errorCode: "CITATION_INVALID", answer: "保留前文。" });
    expect(turn.citations).toEqual([]);
  });
  it("corrects a prose-only planning response without forcing a search or exceeding the allowance", async () => {
    let calls = 0;
    model.complete = jest.fn(async (_u, _s, input) => {
      if (++calls === 1) return { usage, content: "无需检索", reasoningContent: "opaque-continuation", toolCalls: [] };
      expect(input.messages.some(m => m.role === "user" && m.content?.includes("No action was executed"))).toBe(true);
      return { usage, toolCalls: finishPlan(input) };
    });
    const turn = await run(await claim());
    expect(turn.status).toBe("completed");
    expect(model.complete).toHaveBeenCalledTimes(2);
    expect(model.stream).toHaveBeenCalledTimes(1);
    expect(books.searchCandidates).not.toHaveBeenCalled();
    expect(turn.answer).not.toContain("无需检索");
  });
  it.each(["missing", "foreign", "mixed"])("rejects invalid decision protocol: %s", async kind => {
    model.complete = jest.fn(async (_u, _s, input) => {
      const calls = finishPlan(input);
      if (kind === "missing") return { usage, content: "READY", toolCalls: [] };
      if (kind === "foreign") {
        const decision = JSON.parse(calls[0].arguments);
        decision.informationNeeds[0].targetSource = "current_book";
        decision.informationNeeds[0].evidenceIds = ["another-turn-id"];
        calls[0].arguments = JSON.stringify(decision);
      }
      if (kind === "mixed") calls.push({ id: "search", name: "search_book", arguments: JSON.stringify({ informationNeed: "测试", queries: { query1: "text", query2: "", query3: "", query4: "" } }) });
      return { usage, toolCalls: calls };
    });
    expect((await run(await claim())).errorCode).toBe(({ missing: "NO_PROGRESS", foreign: "EVIDENCE_INVALID", mixed: "MODEL_CONTROL_TOOL_MIXED" })[kind]);
    expect(books.searchCandidates).not.toHaveBeenCalled();
    if (kind === "missing") {
      expect(model.complete).toHaveBeenCalledTimes(2);
      expect(model.stream).toHaveBeenCalledTimes(1);
    } else expect(model.stream).not.toHaveBeenCalled();
  });
  it("bounds repeated unchanged observations and preserves the final stream", async () => {
    model.complete = jest.fn(async () => ({ usage, toolCalls: [{ id: "s", name: "search_book", arguments: JSON.stringify({ informationNeed: "解释本书概念", queries: { query1: "text", query2: "", query3: "", query4: "" } }) }] }));
    const turn = await run(await claim());
    expect(turn.errorCode).toBe("NO_PROGRESS");
    expect(books.searchCandidates).toHaveBeenCalledTimes(2);
    expect(model.stream).toHaveBeenCalledTimes(1);
  });
  it("finishes with stated limitations after one rewrite still finds nothing", async () => {
    books.searchCandidates = jest.fn(async () => ({ state: "ready" as const, candidates: [], budgetLimited: false, contextTruncated: false, unavailable: [] }));
    let round = 0;
    model.complete = jest.fn(async (_u, _s, input) => {
      if (++round < 3) return { usage, toolCalls: [{ id: "s" + round, name: "search_book", arguments: JSON.stringify({ informationNeed: "查找术语解释", queries: { query1: round === 1 ? "SSD I/O" : "固态硬盘 读写", query2: "", query3: "", query4: "" } }) }] };
      const call = finishPlan(input)[0];
      call.arguments = JSON.stringify({ ...JSON.parse(call.arguments), insufficientEvidence: ["两次查询均未找到解释"], conclusion: "结束检索并说明限制" });
      return { usage, toolCalls: [call] };
    });
    model.stream = jest.fn(async (_u, _s, input, delta) => {
      expect(JSON.parse(input.messages[input.messages.length - 1].content!).RESEARCH_DECISION.evidenceInsufficient).toBe(true);
      await delta("本次未找到书内证据。"); return { usage, finishReason: "stop" };
    });
    expect((await run(await claim())).status).toBe("completed");
    expect(books.searchCandidates).toHaveBeenCalledTimes(2);
  });
  it("accepts a detailed research conclusion without spending another planning call", async () => {
    model.complete = jest.fn(async (_u, _s, input) => {
      const calls = finishPlan(input);
      calls[0].arguments = JSON.stringify({ ...JSON.parse(calls[0].arguments), conclusion: "说明".repeat(600) });
      return { usage, toolCalls: calls };
    });
    expect((await run(await claim())).status).toBe("completed");
    expect(model.complete).toHaveBeenCalledTimes(1);
  });
  it("reports decision field constraints and permits correction within remaining planning calls", async () => {
    let round = 0;
    model.complete = jest.fn(async (_u, _s, input) => {
      const calls = finishPlan(input);
      if (++round === 1) calls[0].arguments = JSON.stringify({ ...JSON.parse(calls[0].arguments), conclusion: "长".repeat(1201) });
      else expect(input.messages.some(m => m.role === "tool" && m.content!.includes('"field":"conclusion"'))).toBe(true);
      return { usage, toolCalls: calls };
    });
    const turn = await run(await claim());
    expect(turn.status).toBe("completed");
    expect(turn.process!.find(p => p.detail.operation === "finish_research" && p.detail.state === "failed")!.detail.validation).toMatchObject({ field: "conclusion", length: 1201 });
    expect(model.complete).toHaveBeenCalledTimes(2); expect(books.searchCandidates).not.toHaveBeenCalled();
  });
  it("reports a provider output limit rather than an empty answer when no text was delivered", async () => {
    model.stream = jest.fn(async () => ({ usage: { promptTokens: 10, completionTokens: 4096, totalTokens: 4106 }, finishReason: "length" }));
    const turn = await run(await claim());
    expect(turn).toMatchObject({ status: "failed", errorCode: "OUTPUT_LIMIT", answer: "" });
    expect(turn.process!.find(p => p.detail.operation === "stream" && p.detail.state === "completed")!.detail).toMatchObject({ finishReason: "length", completionTokens: 4096, deltaCount: 0 });
  });
  it("raises planning/answer output to 3072/8192 while honoring smaller model limits", async () => {
    const c = await claim(); c.snapshot = { ...snapshot, maxOutputTokens: 16384 };
    expect(c.turn.deadline - c.turn.createdAt).toBe(QA_POLICY.deadlineMs);
    expect((await run(c)).status).toBe("completed");
    expect((model.complete as jest.Mock).mock.calls[0][2].maxOutputTokens).toBe(3072);
    expect((model.stream as jest.Mock).mock.calls[0][2].maxOutputTokens).toBe(8192);
  });
  it("rejects inconsistent usage and output budget overrun", async () => {
    model.complete = async () => ({
      toolCalls: [],
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 4 },
    });
    const c = await claim();
    expect((await run(c)).errorCode).toBe("MODEL_USAGE_INVALID");
    expect(model.stream).not.toHaveBeenCalled();
  });
  it("distinguishes a candidate allowance from an exhausted round budget", async () => {
    books.searchCandidates = jest.fn(async () => ({ state: "ready" as const, candidates: [evidence()], budgetLimited: true, contextTruncated: false, unavailable: [] }));
    let calls = 0;
    model.complete = jest.fn(async (_u, _s, input) => ({ usage, toolCalls: ++calls === 1
      ? [{ id: "search", name: "search_book", arguments: JSON.stringify({ informationNeed: "解释正文", queries: { query1: "正文", query2: "", query3: "", query4: "" } }) }]
      : finishPlan(input) }));
    const turn = await run(await claim());
    expect(turn.status).toBe("completed");
    expect(turn.errorCode).toBeNull();
    const input = (model.stream as jest.Mock).mock.calls[0][2] as QaModelInput;
    const final = JSON.parse(input.messages[input.messages.length - 1].content!);
    expect(final.RESEARCH_LIMITATIONS).toMatchObject({ budgetExhausted: false });
    expect(JSON.parse(final.HOST_OBSERVATIONS.observations[0].result).budgetLimited).toBe(true);
    expect(final.RESEARCH_LIMITATIONS.remainingReadChars).toBeGreaterThan(0);
    expect(final.researchStatusInstruction).toContain("searches completed without failure");
    expect(final.researchStatusInstruction).toContain("No host execution limit");
  });

  it("does not complete an evidence-backed answer with unbound numeric citations", async () => {
    model.stream = jest.fn(async (_u, _s, input, delta) => {
      const final = JSON.parse(input.messages[input.messages.length - 1].content!);
      expect(final.citationExample).toBe("[[evidence:s1]]");
      await delta("书内事实[1]"); return { usage, finishReason: "stop" };
    });
    expect(await run(await claim())).toMatchObject({ status: "failed", errorCode: "CITATION_INVALID", answer: "书内事实[1]" });
  });

  // These exercise the actual checker and persistent runtime, without the
  // passingQualityFixture used by action-specific P0 regressions above.
  it("corrects an actual rejected draft through the same action loop and replays only the current version", async () => {
    const expanded = evidence({ ...selection, canonicalQuote: "text，仅适用于允许陈旧数据的场景", displayedQuote: "text，仅适用于允许陈旧数据的场景", end: 19 });
    expanded.end = expanded.quote.length;
    expanded.locator.position.end = expanded.end;
    books.expandSelected = jest.fn(async (_u, _s, input) => ({ candidates: [expanded], contextWindows: [{ sectionIndex: 0, start: 0, end: expanded.end, hitRanges: input.evidence.map(e => ({ sectionIndex: 0, start: e.start, end: e.end })) }], contextTruncated: false }));
    let checks = 0, actedOnFeedback = false, drafts = 0;
    model.complete = jest.fn(async (_u, _s, input) => {
      // Providers reject an assistant turn with neither content nor tool calls (HTTP 400).
      expect(input.messages.filter(m => m.role === "assistant" && !m.content && !m.toolCalls?.length)).toEqual([]);
      const checking = input.tools?.some(t => t.function.name === "assess_answer");
      if (checking) {
        const draft = JSON.parse(input.messages.find(m => m.content?.includes('"actualFrozenAnswer"'))!.content!);
        expect(draft.actualFrozenAnswer).toContain(checks ? "允许陈旧" : "任何场景");
        const verdict = checks++ ? { verdict: "pass", issues: [] } : { verdict: "revise", issues: [{ claim: "任何场景", problem: "未核实适用范围", evidenceIds: ["s1"], action: "补充限定再回答" }] };
        return { usage, toolCalls: [{ id: `judge-${checks}`, name: "assess_answer", arguments: JSON.stringify(verdict) }] };
      }
      if (withContext(input)) return { usage, toolCalls: [contextCall] };
      if (checks === 1 && !actedOnFeedback) {
        expect(input.messages.some(m => m.content?.includes("fallible_quality_assessment_not_source_evidence"))).toBe(true);
        actedOnFeedback = true;
        return { usage, toolCalls: [{ id: "expand-after-check", name: "expand_evidence", arguments: JSON.stringify({ evidenceIds: [idFrom(input)], maxWindowChars: 100 }) }] };
      }
      return { usage, toolCalls: finishPlan(input) };
    });
    model.stream = jest.fn(async (_u, _s, input, delta) => {
      const passages = JSON.parse(input.messages[input.messages.length - 1].content!).VERIFIED_EVIDENCE;
      await delta(`${drafts++ ? "仅适用于允许陈旧数据的场景" : "适用于任何场景"} [[evidence:${passages[passages.length - 1].evidenceId}]]`);
      return { usage, finishReason: "stop" };
    });
    executor = new SelectionQaExecutor(store, model, books, { get: () => ({ bookId: 1, title: "测试书" }) }, env => new QaToolRegistry([...createQaReadingTools(env), ...createQaDeliveryTools(env.ledger, env.currentBook)]));
    const c = await claim();
    const result = await run(c);
    expect(result).toMatchObject({ status: "completed", answerVersion: 2, quality: { verdict: "pass", answerVersion: 2 } });
    expect(result.answer).toContain("仅适用于允许陈旧");
    expect(result.answer).not.toContain("任何场景");
    expect(result.citations).toHaveLength(1);
    const events = records.events(1, c.turn.id, 0);
    let version = 0, answer = "", citations: string[] = [];
    for (const event of events) {
      if (event.data.operation === "answer_version") { version = Number(event.data.answerVersion); answer = ""; citations = []; }
      if (event.kind === "answer_delta") { expect(event.data.answerVersion).toBe(version); answer += event.data.text; }
      if (event.kind === "citation") { expect(event.data.answerVersion).toBe(version); citations.push((event.data.evidence as { evidenceId: string }).evidenceId); }
    }
    expect(answer).toBe(result.answer);
    expect(citations).toEqual(result.citations.map(e => e.evidenceId));
    expect(events[events.length - 1].data).toMatchObject({ answerVersion: 2, answer, quality: { verdict: "pass", answerVersion: 2 } });
  });

  it.each(["checking", "revising", "revised_checking"].flatMap(stage => ["cancel", "replace", "timeout", "restart", "restart_expired"].map(cause => ({stage,cause}))))("fences late model results after $cause during $stage", async ({stage,cause}) => {
    let checks = 0;
    const terminate = (turnId: string) => {
      if (cause === "cancel") service.stop(1, turnId);
      if (cause === "replace") current = false;
      if (cause === "timeout" || cause === "restart_expired") db.prepare("UPDATE selection_qa_turns SET deadline=1 WHERE id=?").run(turnId);
      if (cause.startsWith("restart")) {
        db.prepare("UPDATE selection_qa_turns SET lease_expires_at=1 WHERE id=?").run(turnId);
        const recreated = new SqliteSelectionQaRuntimeStore({getDatabase:()=>db} as SqliteService,records,{resolve:async()=>selection,assertCurrent:()=>{}});
        recreated.maintain(Date.now());
        expect(recreated.claim("replacement",Date.now())).toBeNull();
      }
    };
    model.complete = jest.fn(async (_u, _s, input) => {
      if (input.tools?.some(t => t.function.name === "assess_answer")) {
        if(stage!=="checking" && checks++===0)
          return {usage,toolCalls:[{id:"revise",name:"assess_answer",arguments:JSON.stringify({verdict:"revise",issues:[{claim:"范围",problem:"遗漏限定",evidenceIds:[],action:"修订"}]})}]};
        if(stage!=="revising")terminate(input.turnId!);
        return { usage, toolCalls: [{ id: "late", name: "assess_answer", arguments: '{"verdict":"pass","issues":[]}' }] };
      }
      if(stage==="revising" && checks===1)terminate(input.turnId!);
      return { usage, toolCalls: withContext(input) ? [contextCall] : finishPlan(input) };
    });
    executor = new SelectionQaExecutor(store, model, books, { get: () => ({ bookId: 1, title: "测试书" }) }, env => new QaToolRegistry([...createQaReadingTools(env), ...createQaDeliveryTools(env.ledger, env.currentBook)]));
    const c = await claim();
    const result = await run(c);
    expect(result.status).toBe(cause === "cancel" ? "cancelled" : ["timeout","restart_expired"].includes(cause) ? "timed_out" : "failed");
    expect(result.quality?.verdict).not.toBe("pass");
    if(cause==="restart")expect(result.errorCode).toBe("worker_interrupted");
    if(cause==="restart_expired")expect(result.errorCode).toBe("DEADLINE_EXCEEDED");
    expect(records.events(1, c.turn.id, 0).filter(e => e.kind === "terminal")).toHaveLength(1);
    const before=records.turn(1,c.turn.id);
    expect(()=>store.append(c,"迟到正文",[])).toThrow("LEASE_LOST");
    expect(records.turn(1,c.turn.id)).toEqual(before);
  });

  it("does not reuse a previous pass for a changed answer version", async () => {
    const c = await claim();
    await run(c);
    // Terminal fencing prevents reopening a completed run even with the same lease.
    expect(() => store.beginAnswer(c, 2)).toThrow("LEASE_LOST");
  });

});
