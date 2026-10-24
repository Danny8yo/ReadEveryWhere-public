/** Opt-in real-model decision evaluation. No Nest app, scheduler or book service is started. */
import "reflect-metadata";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { parse as parseEnv } from "dotenv";
import { CryptoService } from "../../src/platform/crypto/crypto.service";
import type { SqliteService } from "../../src/platform/persistence/sqlite/sqlite.service";
import { DeepSeekLanguageModelAdapter } from "../../src/integrations/deepseek/deepseek-language-model.adapter";
import { DEEPSEEK_DEFAULT_MODEL_CONFIG, DeepSeekModelProfileContribution } from "../../src/integrations/deepseek/deepseek-model-profile.contribution";
import { DeepSeekTokenEstimator } from "../../src/integrations/deepseek/deepseek-token-estimator";
import { LanguageModelGateway } from "../../src/support/ai-model/application/language-model.gateway";
import { ModelProfileRegistry } from "../../src/support/ai-model/application/model-profile";
import { AutomaticPrefixPromptCachePolicy, PromptCachePolicyRegistry } from "../../src/support/ai-model/application/prompt-cache-policy";
import { ProviderRegistry } from "../../src/support/ai-model/application/provider-registry";
import { TokenEstimatorRegistry } from "../../src/support/ai-model/application/ports/token-estimator.port";
import { ModelConfigRepository } from "../../src/support/ai-model/infrastructure/model-config.repository";
import { QaContextBuilder } from "../../src/modules/ai-reading/selection-qa/application/qa-context";
import { QaEvidenceLedger, qaEvidenceResult } from "../../src/modules/ai-reading/selection-qa/application/qa-evidence";
import { parseDecision } from "../../src/modules/ai-reading/selection-qa/application/selection-qa-decision";
import type { QaBookPort, QaClaim, QaEvidence, QaMessage, QaModelSnapshot, QaRuntimeStore, QaTool, QaToolCall } from "../../src/modules/ai-reading/selection-qa/application/selection-qa-runtime.port";
import { createQaDeliveryTools } from "../../src/modules/ai-reading/selection-qa/application/tools/qa-delivery-tools";
import { createQaReadingTools, qaReadingObservation } from "../../src/modules/ai-reading/selection-qa/application/tools/qa-reading-tools";
import { QaToolRegistry, qaArguments } from "../../src/modules/ai-reading/selection-qa/application/tools/qa-tool-registry";
import { SelectionQaModelAdapter } from "../../src/modules/ai-reading/selection-qa/infrastructure/selection-qa-model.adapter";
import { validateSearchArguments } from "../../src/modules/ai-reading/selection-qa/application/selection-qa-query-policy";

const ACTUAL_CALL_LIMIT = 18;
const PLANNED_CALLS = 12;
const TIMEOUT_MS = 120000;
const currentBook = { bookId: 900001, title: "缓存一致性：自制评测语料" };
const revision = { fileChecksum: "controlled-fixture-checksum", extractorVersion: "controlled-fixture-v1", normalizationVersion: "controlled-fixture-v1" };
const selectedText = "缓存把近期读取的结果保存在快速存储中，缓存命中后不必再次读取慢速源。";
const authority = "本例的权威数据保存在数据库中。每次数据库更新成功后，写入方必须立即使对应缓存条目失效；后续读取重新从数据库载入该条目。";
const abbreviated = "读取请求命中缓存时直接返回缓存条目。";
const qualified = `${abbreviated}这一做法只适用于允许最多一秒陈旧数据的场景；如果业务要求读取最近一次已提交的值，读取方必须绕过缓存并查询权威数据库。`;

type Condition = "sufficient" | "empty" | "missing_qualification" | "expanded_qualification" | "recoverable_error" | "successful_result";
type Pair = { id: string; question: string; conditions: readonly [Condition, Condition]; rubric: Record<string, string> };
const pairs: Pair[] = [
  {
    id: "evidence-vs-empty",
    question: "根据本书的例子，数据库更新成功后怎样避免后续请求继续读到旧缓存？",
    conditions: ["sufficient", "empty"],
    rubric: {
      sufficient: "已给出直接回答当前问题的原文，可选择交付并选中该证据；继续读取须有具体未满足需求。",
      empty: "应根据空结果改查询或换可用阅读行动，或诚实限定现有证据不足；不能把空结果当全书不存在。",
      comparison: "检查空结果是否引发与充分证据不同且合理的行动或交付限制；不要求唯一工具顺序。",
    },
  },
  {
    id: "qualification-feedback",
    question: "本书这个缓存命中即返回的做法，能用于所有一致性要求吗？请说明关键限制。",
    conditions: ["missing_qualification", "expanded_qualification"],
    rubric: {
      missing_qualification: "片段尚未回答一致性边界且边界不完整，应继续获取限定或明确不足，不能断言适用所有场景。",
      expanded_qualification: "应选择包含新限定的证据，并把允许最多一秒陈旧与强一致读取绕过缓存的区别纳入信息需求/交付决定；可据此结束。",
      comparison: "检查新限定是否改变选证、待解决需求或下一步行动；不把两侧都结束自动判为失败，须审阅限制是否随观察更新。",
    },
  },
  {
    id: "parameter-feedback",
    question: "根据本书，写入数据库后要对缓存做什么处理？",
    conditions: ["recoverable_error", "successful_result"],
    rubric: {
      recoverable_error: "应修正参数或换其他可用行动；明确操作未执行，不能把参数错误说成成功但没命中。",
      successful_result: "已有直接证据时可选证交付；不应照搬参数纠错或无结果结论。",
      comparison: "这组人为注入参数反馈，以隔离模型对观察的反应；不是宣称相同参数在真实检索里随机有效或无效。",
    },
  },
];

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`MISSING_${name}`);
  return value;
}
function stableError(error: unknown): string {
  if (error instanceof Error && "code" in error && typeof error.code === "string") return error.code;
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) return error.message;
  return "EVALUATION_FAILED";
}
function writeJson(path: string, value: unknown): void { writeFileSync(path, JSON.stringify(value, null, 2), { mode: 0o600 }); }
function evidence(quote: string, start: number, contextTruncated = false): QaEvidence {
  return {
    quote, displayedQuote: quote, quoteHash: createHash("sha256").update(quote).digest("hex"),
    sectionIndex: 0, href: "fixture.xhtml", start, end: start + quote.length, cfi: `fixture:${start}:${start + quote.length}`, contextTruncated,
    locator: { version: 1, bookId: currentBook.bookId, contentRevision: revision, position: { kind: "epub_text", sectionIndex: 0, start, end: start + quote.length } },
  };
}
function claim(snapshot: QaModelSnapshot, userId: number, pair: Pair): QaClaim {
  const now = Date.now();
  return {
    owner: "controlled-observation-eval", token: "isolated-token", generation: 1, snapshot,
    conversation: { id: `controlled-${pair.id}`, userId, bookId: currentBook.bookId, status: "active", frozenReason: null, firstQuestion: pair.question, createdAt: now, updatedAt: now,
      selection: { scope: { bookId: currentBook.bookId, ...revision, sectionIndex: 0, href: "fixture.xhtml" }, artifact: { bookId: currentBook.bookId, artifactId: "controlled-fixture", fileChecksum: revision.fileChecksum }, canonicalQuote: selectedText, displayedQuote: selectedText, start: 0, end: selectedText.length, source: { start: { path: [0], offset: 0 }, end: { path: [0], offset: selectedText.length } } } },
    turn: { id: `controlled-${pair.id}`, userId, conversationId: `controlled-${pair.id}`, turnNumber: 1, question: pair.question, answer: "", status: "running", errorCode: null, retryOfTurnId: null, deadline: now + 240000, lastSequence: 0, phase: "planning", citations: [], createdAt: now, updatedAt: now },
  };
}
function modelStore() {
  const phases: unknown[] = [];
  const unexpected = () => { throw new Error("UNEXPECTED_RUNTIME_OPERATION"); };
  const store: QaRuntimeStore = {
    claim: unexpected, maintain: unexpected, mutate: unexpected, renew: unexpected,
    reserveModel: unexpected, reserveTool: unexpected, chargeRead: unexpected, usage: unexpected,
    append: unexpected, finish: unexpected, history: unexpected,
    remaining: () => ({ models: 4, tools: 4, chars: 20000 }),
    phase: (_claim, phase, detail) => { phases.push({ phase, detail }); },
    evidence: () => {},
  };
  return { store, phases };
}
function controlledInput(snapshot: QaModelSnapshot, userId: number, pair: Pair, condition: Condition) {
  const current = claim(snapshot, userId, pair);
  const { store, phases } = modelStore();
  const ledger = new QaEvidenceLedger(current, store);
  const emptyHistory = { turns: [], historicalEvidence: [], research: [] };
  const noBookCalls = new Proxy({}, { get: () => () => { throw new Error("CONTROLLED_EVALUATION_MUST_NOT_READ_BOOKS"); } }) as QaBookPort;
  const env = { claim: current, store, books: noBookCalls, currentBook, ledger, history: emptyHistory, searchOutcome: { succeeded: 0, failed: 0 } };
  // Freeze the same generic schemas before observations add evidence IDs, so a
  // changing enum cannot be mistaken for an effect of the observation itself.
  const tools: QaTool[] = new QaToolRegistry([...createQaReadingTools(env), ...createQaDeliveryTools(ledger, currentBook)]).definitions();
  let call: QaToolCall = { id: "observed-action", name: "search_book", arguments: JSON.stringify({ informationNeed: "缓存写入后的处理", queries: { query1: "缓存 一致性 失效", query2: "", query3: "", query4: "" } }) };
  let data: Record<string, unknown>;
  if (condition === "missing_qualification" || condition === "expanded_qualification") {
    const original = ledger.save(evidence(abbreviated, 300, true));
    call = { id: "observed-action", name: "expand_evidence", arguments: JSON.stringify({ evidenceIds: [original.evidenceId], maxWindowChars: 1600 }) };
    const expanded = condition === "expanded_qualification" ? ledger.save(evidence(qualified, 300)) : original;
    data = { observationStatus: "success", sourceBook: currentBook, resultCount: 1, contextTruncated: condition === "missing_qualification", results: [{ ...qaEvidenceResult(expanded, currentBook), sourceEvidenceId: original.evidenceId }] };
  } else if (condition === "recoverable_error") {
    data = { observationStatus: "recoverable_error", error: "TOOL_ARGUMENTS_INVALID", errorCode: "TOOL_ARGUMENTS_INVALID", validation: { field: "queries.query1", constraint: "query contains an unsupported lexical form; use different complete phrases" }, instruction: "Correct the query parameters using the schema. No book operation was performed; this is not an empty search result." };
  } else if (condition === "empty") {
    data = { observationStatus: "empty", sourceBook: currentBook, resultCount: 0, results: [], unavailable: [], budgetLimited: false, contextTruncated: false };
  } else {
    const saved = ledger.save(evidence(authority, 100));
    data = { observationStatus: "success", sourceBook: currentBook, resultCount: 1, results: [qaEvidenceResult(saved, currentBook)], unavailable: [], budgetLimited: false, contextTruncated: false };
  }
  // Use the production projection: evidence text is provided once through
  // VERIFIED_EVIDENCE while the report preserves the full controlled quote.
  const modelObservation = Array.isArray(data.results)
    ? qaReadingObservation(data.results as Array<ReturnType<typeof qaEvidenceResult>>, data)
    : data;
  const messages: QaMessage[] = [
    { role: "assistant", content: null, toolCalls: [call] },
    { role: "tool", toolCallId: call.id, content: JSON.stringify({ operationKind: "reading", ...modelObservation }) },
  ];
  const searchOutcome = condition === "recoverable_error" ? { succeeded: 0, failed: 1 }
    : condition === "missing_qualification" || condition === "expanded_qualification" ? { succeeded: 0, failed: 0 }
      : { succeeded: 1, failed: 0 };
  return { current, store, phases, ledger, tools, messages, history: emptyHistory, searchOutcome, observedCall: call, observation: data };
}
function actionChecks(calls: QaToolCall[], allowed: QaTool[], ledger: QaEvidenceLedger) {
  const names = new Set(allowed.map(tool => tool.function.name));
  return calls.map(call => {
    let protocolValid = names.has(call.name);
    let reason: string | null = protocolValid ? null : "TOOL_NOT_ALLOWED";
    try {
      const args = qaArguments(call.arguments);
      if (call.name === "finish_research") parseDecision(args, ledger.items);
      if (call.name === "search_book" || call.name === "repeat_book_search") validateSearchArguments(args);
    } catch (error) { protocolValid = false; reason = stableError(error); }
    return { callId: call.id, name: call.name, arguments: call.arguments, protocolValid, reason };
  });
}

async function main() {
  if (process.env.QA_PAIR_ALLOW_PAID !== "1") throw new Error("PAID_EVALUATION_NOT_ENABLED");
  const sourcePath = resolve(required("QA_PAIR_DATABASE"));
  const credentialsPath = resolve(required("QA_PAIR_CREDENTIALS"));
  const output = resolve(required("QA_PAIR_RUN_DIR"));
  const inTemp = [tmpdir(), "/tmp"].some(root => {
    const path = relative(resolve(root), output);
    return Boolean(path) && !path.startsWith("..") && !isAbsolute(path);
  });
  if (!inTemp || existsSync(output)) throw new Error("FRESH_TEMP_OUTPUT_REQUIRED");
  mkdirSync(output, { recursive: true, mode: 0o700 });
  if (process.env.QA_PAIR_MODEL_ENV_FILE) {
    const value = parseEnv(readFileSync(resolve(process.env.QA_PAIR_MODEL_ENV_FILE)));
    if (!value.ENCRYPTION_KEY) throw new Error("MODEL_DECRYPTION_CONFIGURATION_MISSING");
    process.env.ENCRYPTION_KEY = value.ENCRYPTION_KEY;
  }
  const credentials = JSON.parse(readFileSync(credentialsPath, "utf8")) as { QA_LIVE_EMAIL?: unknown };
  if (typeof credentials.QA_LIVE_EMAIL !== "string" || !credentials.QA_LIVE_EMAIL.trim()) throw new Error("EVALUATION_ACCOUNT_MISSING");
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  const copied = join(output, "isolated-model-config.sqlite");
  try { await backup(source, copied); } finally { source.close(); }
  const database = new DatabaseSync(copied, { readOnly: true });
  const reportPath = join(output, "paired-observations.json");
  const ledgerPath = join(output, "actual-model-requests.json");
  const results: Array<Record<string, unknown>> = [];
  const requests: Array<Record<string, unknown>> = [];
  const report: Record<string, unknown> = {
    evaluationType: "controlled-observation-real-model-next-action", createdAt: new Date().toISOString(),
    implementationFingerprints: Object.fromEntries([
      "application/qa-context.ts", "application/tools/qa-reading-tools.ts", "application/selection-qa-decision.ts",
      "infrastructure/selection-qa-model.adapter.ts",
    ].map(path => [path, createHash("sha256").update(readFileSync(resolve(__dirname, "../../src/modules/ai-reading/selection-qa", path))).digest("hex")])),
    isolation: "Read-only SQLite backup for authorized model configuration; synthetic book scope and authored observations; no scheduler, HTTP server, book lookup or source database writes.",
    limitations: "Injected observations test next-action sensitivity, not real retrieval or final-answer quality. Parameter-error feedback is deliberately controlled, not a claim that identical real parameters randomly pass or fail. Manual rubric review is required.",
    plannedCalls: PLANNED_CALLS, actualCallLimit: ACTUAL_CALL_LIMIT, repeatsPerObservation: 2,
    pairs, results, actualRequests: requests, status: "running", manualReview: "pending",
  };
  const checkpoint = () => { writeJson(reportPath, report); writeJson(ledgerPath, requests); };
  checkpoint();
  try {
    const account = database.prepare("SELECT id FROM users WHERE email=?").get(credentials.QA_LIVE_EMAIL.toLowerCase().trim());
    if (!account || !Number.isSafeInteger(account.id)) throw new Error("EVALUATION_ACCOUNT_NOT_FOUND");
    const userId = Number(account.id);
    const configs = new ModelConfigRepository({ getDatabase: () => database } as SqliteService, new CryptoService(), DEEPSEEK_DEFAULT_MODEL_CONFIG, new Set(["deepseek"]));
    const profiles = new ModelProfileRegistry([new DeepSeekModelProfileContribution()]);
    const tokenizers = new TokenEstimatorRegistry([new DeepSeekTokenEstimator()]);
    let activeCase = "unassigned";
    const countedFetch = async (url: string, init?: RequestInit): Promise<Response> => {
      const target = new URL(url);
      if (target.protocol !== "https:" || target.hostname !== "api.deepseek.com") throw new Error("UNEXPECTED_MODEL_DESTINATION");
      if (requests.length >= ACTUAL_CALL_LIMIT) throw new Error("ACTUAL_MODEL_CALL_LIMIT");
      const item: Record<string, unknown> = { request: requests.length + 1, case: activeCase, startedAt: new Date().toISOString(), status: "started" };
      requests.push(item); checkpoint();
      const started = Date.now();
      try {
        const response = await fetch(url, init);
        item.status = "response"; item.httpStatus = response.status; item.elapsedMs = Date.now() - started; checkpoint();
        return response;
      } catch (error) { item.status = "failed"; item.errorCode = stableError(error); item.elapsedMs = Date.now() - started; checkpoint(); throw error; }
    };
    const provider = new DeepSeekLanguageModelAdapter(countedFetch);
    const gateway = new LanguageModelGateway(new ProviderRegistry([provider]), profiles, new PromptCachePolicyRegistry([new AutomaticPrefixPromptCachePolicy()]), tokenizers);
    const model = new SelectionQaModelAdapter(gateway, configs, profiles, tokenizers);
    const snapshot = model.snapshot(userId);
    report.model = { providerId: snapshot.providerId, modelId: snapshot.modelId, tokenizerId: snapshot.tokenizerId, contextWindowTokens: snapshot.contextWindowTokens, maxOutputTokens: 3072, transportMaxAttempts: 1 };
    checkpoint();
    // Interleave repeat order, so one condition is not always the first cache/cold request.
    for (const pair of pairs) for (const repetition of [1, 2]) {
      const order = repetition === 1 ? pair.conditions : [...pair.conditions].reverse();
      for (const condition of order) {
        activeCase = `${pair.id}/${condition}/${repetition}`;
        const prepared = controlledInput(snapshot, userId, pair, condition);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort("EVALUATION_TIMEOUT"), TIMEOUT_MS);
        const before = requests.length;
        const started = Date.now();
        try {
          const input = new QaContextBuilder(model, prepared.store).build({ claim: prepared.current, currentBook, history: prepared.history,
            messages: prepared.messages, evidence: prepared.ledger.items, tools: prepared.tools, signal: controller.signal,
            final: false, searchOutcome: prepared.searchOutcome, deadline: Date.now() + TIMEOUT_MS });
          const response = await model.complete(userId, snapshot, input);
          const actions = actionChecks(response.toolCalls, prepared.tools, prepared.ledger);
          results.push({ pair: pair.id, condition, repetition, question: pair.question, observedCall: prepared.observedCall, observation: prepared.observation,
            modelInput: { messages: input.messages, tools: input.tools, maxOutputTokens: input.maxOutputTokens },
            toolSchemaFingerprint: createHash("sha256").update(JSON.stringify(prepared.tools)).digest("hex"),
            availableBudget: { models: 4, tools: 4, chars: 20000, timeoutMs: TIMEOUT_MS },
            actions, actionFingerprint: JSON.stringify(actions.map(action => ({ name: action.name, arguments: action.arguments }))),
            elapsedMs: Date.now() - started, actualCalls: requests.length - before, usage: response.usage,
            discardedIntermediateContentChars: response.content?.length ?? 0,
            contextUsage: prepared.phases,
            manualReasonableness: "pending", status: "completed",
          });
          checkpoint();
          process.stdout.write(JSON.stringify({ event: "QA_PAIR_CASE", pair: pair.id, condition, repetition, actions: actions.map(action => action.name), actualCalls: requests.length, elapsedMs: Date.now() - started, usage: response.usage }) + "\n");
        } catch (error) {
          results.push({ pair: pair.id, condition, repetition, actualCalls: requests.length - before, elapsedMs: Date.now() - started, errorCode: stableError(error), status: "failed", manualReasonableness: "pending" });
          report.status = "failed"; checkpoint(); throw error;
        } finally { clearTimeout(timer); }
      }
    }
    if (results.length !== PLANNED_CALLS || requests.length !== PLANNED_CALLS) throw new Error("UNEXPECTED_EVALUATION_CALL_COUNT");
    report.status = "completed_pending_manual_review";
    report.totals = { actualCalls: requests.length, elapsedMs: results.reduce((sum, item) => sum + Number(item.elapsedMs), 0),
      promptTokens: results.reduce((sum, item) => sum + Number((item.usage as { promptTokens: number }).promptTokens), 0),
      completionTokens: results.reduce((sum, item) => sum + Number((item.usage as { completionTokens: number }).completionTokens), 0) };
    checkpoint();
    process.stdout.write(JSON.stringify({ event: "QA_PAIR_REPORT", path: reportPath, actualCalls: requests.length, status: report.status }) + "\n");
  } catch (error) {
    report.status = "failed";
    report.errorCode = stableError(error);
    checkpoint();
    throw error;
  } finally { database.close(); }
}

if (require.main === module) main().catch(error => { process.stderr.write(`${stableError(error)}\n`); process.exitCode = 1; });
