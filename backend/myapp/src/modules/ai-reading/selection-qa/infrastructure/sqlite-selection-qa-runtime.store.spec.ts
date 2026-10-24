import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { initializeSchema } from "../../../../platform/persistence/sqlite/schema-migrations";
import { seedUpgradeFixture } from "../../../../platform/persistence/sqlite/schema-upgrade.fixture";
import { SqliteService } from "../../../../platform/persistence/sqlite/sqlite.service";
import { SqliteSelectionQaRepository } from "./sqlite-selection-qa.repository";
import { SqliteSelectionQaRuntimeStore } from "./sqlite-selection-qa-runtime.store";
import { SelectionQaService } from "../application/selection-qa.service";
import { QA_POLICY, type QaSavedEvidence, type QaModelSnapshot } from "../application/selection-qa-runtime.port";
import type { SelectionSnapshot } from "../application/selection-qa.types";
const selection: SelectionSnapshot = {
  scope: { bookId: 1, fileChecksum: "sha256:fixture", extractorVersion: "v1", normalizationVersion: "v1", sectionIndex: 0, href: "chapter.xhtml" },
  artifact: { bookId: 1, artifactId: "artifact", fileChecksum: "sha256:fixture" },
  source: { start: { path: [0], offset: 0 }, end: { path: [0], offset: 2 } },
  displayedQuote: "正文", canonicalQuote: "正文", start: 0, end: 2,
};
const snapshot: QaModelSnapshot = { version: 1, providerId: "test", modelId: "test", configUpdatedAt: null, tokenizerId: "test", contextWindowTokens: 64000, maxOutputTokens: 4096, policyVersion: QA_POLICY.version };
function evidence(id: string): QaSavedEvidence {
  return {
    evidenceId: id, locator: { version: 1, bookId: 1, contentRevision: { fileChecksum: selection.scope.fileChecksum, extractorVersion: "v1", normalizationVersion: "v1" }, position: { kind: "epub_text", sectionIndex: 0, start: 0, end: 2 } },
    quote: "正文", quoteHash: createHash("sha256").update("正文").digest("hex"), displayedQuote: "正文", sectionIndex: 0, href: "chapter.xhtml", start: 0, end: 2, cfi: "cfi",
  };
}
describe("selection QA history preserves only actually cited evidence", () => {
  let db: DatabaseSync, runtime: SqliteSelectionQaRuntimeStore, service: SelectionQaService;
  beforeEach(() => {
    db = new DatabaseSync(":memory:"); db.exec("PRAGMA foreign_keys=ON"); initializeSchema(db); seedUpgradeFixture(db);
    const sqlite = { getDatabase: () => db } as SqliteService;
    const records = new SqliteSelectionQaRepository(sqlite);
    const content = { resolve: async () => selection, assertCurrent: () => {} };
    runtime = new SqliteSelectionQaRuntimeStore(sqlite, records, content);
    service = new SelectionQaService(records, content, { findReceipt: () => null, execute: async () => { throw new Error("unused"); } }, { snapshot: () => snapshot });
  });
  afterEach(() => db.close());
  // These history fixtures represent pre-P1 completed records; no judgment is fabricated.
  function finishHistorical(c: import("../application/selection-qa-runtime.port").QaClaim) {
    runtime.finish(c, "failed", "fixture_setup");
    db.prepare("UPDATE selection_qa_turns SET status='completed',error_code=NULL WHERE id=?").run(c.turn.id);
  }
  async function previous(citations: string[], missing = false) {
    await service.create(1, { commandId: "create", bookId: 1, selection, question: "解释" });
    const first = runtime.claim("owner", Date.now())!;
    for (const id of ["e_000_rejected", "e_001_rejected", ...citations]) if (!missing || id !== citations[0]) runtime.evidence(first, evidence(id));
    runtime.append(first, "回答", citations.map(evidence)); finishHistorical(first);
    service.addTurn(1, first.conversation.id, { commandId: "next", question: "追问" });
    return { first, next: runtime.claim("owner", Date.now())! };
  }
  it("remembers completed unresolved searches beyond the recent three turns and excludes failures", async () => {
    await service.create(1, { commandId: "create", bookId: 1, selection, question: "书内是否支持命题" });
    const first = runtime.claim("owner", Date.now())!;
    runtime.phase(first, "retrieving", { operation: "search_book", state: "started", callId: "good", informationNeed: "命题依据", queries: ["命题"] });
    runtime.phase(first, "retrieving", { operation: "search_book", state: "completed", callId: "good", resultCount: 3 });
    runtime.phase(first, "retrieving", { operation: "search_book", state: "started", callId: "bad", informationNeed: "其他依据", queries: ["失败查询"] });
    runtime.phase(first, "retrieving", { operation: "search_book", state: "failed", callId: "bad" });
    runtime.phase(first, "planning", { operation: "finish_research", state: "completed", insufficientEvidence: ["尚缺直接证据"] });
    finishHistorical(first);
    for (let n = 0; n < 4; n++) {
      service.addTurn(1, first.conversation.id, { commandId: `middle-${n}`, question: "解释其他概念" });
      const c = runtime.claim("owner", Date.now())!;
      finishHistorical(c);
    }
    service.addTurn(1, first.conversation.id, { commandId: "last", question: "再次问命题" });
    const last = runtime.claim("owner", Date.now())!;
    const history = runtime.history(last);
    expect(history.turns.some(t => t.id === first.turn.id)).toBe(true);
    expect(history.research).toEqual([{ turnId: first.turn.id, question: "书内是否支持命题", informationNeed: "命题依据", queries: ["命题"], resultCount: 3, selectedCandidateCount: null, unresolved: true }]);
  });
  it("remembers candidate and selected counts separately for each completed search", async () => {
    await service.create(1, { commandId: "create", bookId: 1, selection, question: "比较索引结构" });
    const first = runtime.claim("owner", Date.now())!;
    const firstCandidates = Array.from({ length: 20 }, (_, n) => ({ evidenceId: `e_first_${n}` }));
    runtime.phase(first, "retrieving", { operation: "search_book", state: "started", callId: "first", informationNeed: "B树", queries: ["B树"] });
    runtime.phase(first, "retrieving", { operation: "search_book", state: "completed", callId: "first", resultCount: 20, results: firstCandidates });
    runtime.phase(first, "retrieving", { operation: "search_book", state: "started", callId: "second", informationNeed: "B+树", queries: ["B+树"] });
    runtime.phase(first, "retrieving", { operation: "search_book", state: "completed", callId: "second", resultCount: 2, results: [{ evidenceId: "e_second_1" }, { evidenceId: "e_second_2" }] });
    runtime.phase(first, "planning", { operation: "finish_research", state: "completed", selectedEvidenceIds: ["e_second_2"], insufficientEvidence: [] });
    finishHistorical(first);
    service.addTurn(1, first.conversation.id, { commandId: "next", question: "追问" });
    const next = runtime.claim("owner", Date.now())!;
    expect(runtime.history(next).research).toMatchObject([
      { resultCount: 20, selectedCandidateCount: 0, unresolved: true },
      { resultCount: 2, selectedCandidateCount: 1, unresolved: false },
    ]);
  });
  it("counts later more_search_results pages of the same reranked search, and only that search", async () => {
    await service.create(1, { commandId: "create", bookId: 1, selection, question: "比较索引结构" });
    const first = runtime.claim("owner", Date.now())!;
    runtime.phase(first, "retrieving", { operation: "search_book", state: "started", callId: "s1", informationNeed: "B树", queries: ["B树"] });
    runtime.phase(first, "retrieving", { operation: "search_book", state: "completed", callId: "s1", searchId: "search-1", resultCount: 2, results: [{ evidenceId: "e_a" }, { evidenceId: "e_b" }] });
    runtime.phase(first, "retrieving", { operation: "search_book", state: "started", callId: "s2", informationNeed: "哈希", queries: ["哈希"] });
    runtime.phase(first, "retrieving", { operation: "search_book", state: "completed", callId: "s2", searchId: "search-2", resultCount: 1, results: [{ evidenceId: "e_z" }] });
    runtime.phase(first, "retrieving", { operation: "search_more", state: "completed", callId: "m1", searchId: "search-1", resultCount: 2, results: [{ evidenceId: "e_c" }, { evidenceId: "e_d" }] });
    runtime.phase(first, "planning", { operation: "finish_research", state: "completed", selectedEvidenceIds: ["e_d"], insufficientEvidence: [] });
    finishHistorical(first);
    service.addTurn(1, first.conversation.id, { commandId: "next", question: "追问" });
    const next = runtime.claim("owner", Date.now())!;
    expect(runtime.history(next).research).toMatchObject([
      { informationNeed: "B树", resultCount: 4, selectedCandidateCount: 1, unresolved: false },
      { informationNeed: "哈希", resultCount: 1, selectedCandidateCount: 0, unresolved: true },
    ]);
  });
  it("ignores rejected candidates and imports only the last two citation targets", async () => {
    const { first, next } = await previous(["e_z_expanded1", "e_z_expanded2", "e_z_expanded3"]);
    const history = runtime.history(next);
    expect(history.historicalEvidence.map(e => e.evidenceId)).toEqual(["e_z_expanded2", "e_z_expanded3"]);
    expect(history.historicalEvidence.every(e => e.turnId === first.turn.id)).toBe(true);
  });
  it("does not invent history when an answer has no citations", async () => {
    const { next } = await previous([]);
    expect(runtime.history(next).historicalEvidence).toEqual([]);
  });
  it("fails when a persisted citation points to missing evidence", async () => {
    const { next } = await previous(["e_z_missing"], true);
    expect(() => runtime.history(next)).toThrow("Persisted citation has no evidence");
  });
  it("reserves the final delivery after all decision calls and survives store reconstruction", async () => {
    await service.create(1, { commandId: "create", bookId: 1, selection, question: "解释" });
    const claim = runtime.claim("owner", Date.now())!;
    for (let count = 0; count < QA_POLICY.maxModelCalls - 2; count++)
      runtime.reserveModel(claim, "decision");
    expect(() => runtime.reserveModel(claim, "decision")).toThrow(
      expect.objectContaining({ code: "MODEL_BUDGET_EXHAUSTED" }),
    );
    expect(runtime.remaining(claim).models).toBe(2);
    const sqlite = { getDatabase: () => db } as SqliteService;
    const reopened = new SqliteSelectionQaRuntimeStore(sqlite, new SqliteSelectionQaRepository(sqlite), { resolve: async () => selection, assertCurrent: () => {} });
    expect(() => reopened.reserveModel(claim, "decision")).toThrow("MODEL_BUDGET_EXHAUSTED");
    reopened.reserveModel(claim, "final");
    expect(db.prepare("SELECT model_call_count FROM selection_qa_turns WHERE id=?").get(claim.turn.id))
      .toMatchObject({ model_call_count: QA_POLICY.maxModelCalls - 1 });
    expect(() => reopened.reserveModel(claim, "final")).toThrow("MODEL_BUDGET_EXHAUSTED");
    reopened.reserveModel(claim, "check");
    expect(reopened.remaining(claim).models).toBe(0);
  });
  it("uses frozen limits instead of silently replacing them with current defaults", async () => {
    await service.create(1, { commandId: "create", bookId: 1, selection, question: "解释" });
    const claim = runtime.claim("owner", Date.now())!;
    db.prepare("UPDATE selection_qa_turns SET budget_json=? WHERE id=?")
      .run(JSON.stringify({ ...QA_POLICY, maxModelCalls: 3, maxToolCalls: 1, maxReadChars: 2, maxAnswerChars: 2 }), claim.turn.id);
    runtime.reserveModel(claim, "decision");
    expect(() => runtime.reserveModel(claim, "decision")).toThrow("MODEL_BUDGET_EXHAUSTED");
    runtime.reserveTool(claim); runtime.chargeRead(claim, 2);
    expect(runtime.remaining(claim)).toEqual({ models: 2, tools: 0, chars: 0 });
    expect(() => runtime.reserveTool(claim)).toThrow("TOOL_BUDGET_EXHAUSTED");
    expect(() => runtime.chargeRead(claim, 1)).toThrow("READ_BUDGET_EXHAUSTED");
    expect(() => runtime.append(claim, "三个字", [])).toThrow("OUTPUT_CHARACTER_LIMIT");
    runtime.reserveModel(claim, "final");
    runtime.append(claim, "答复", []);
    runtime.finish(claim, "failed", "RESEARCH_BUDGET_EXHAUSTED");
    expect(db.prepare("SELECT status,error_code,answer FROM selection_qa_turns WHERE id=?").get(claim.turn.id))
      .toEqual({ status: "failed", error_code: "RESEARCH_BUDGET_EXHAUSTED", answer: "答复" });
    expect(() => runtime.append(claim, "迟到", [])).toThrow("LEASE_LOST");
  });
  it.each([{}, { ...QA_POLICY, maxModelCalls: 41 }, { ...QA_POLICY, maxReadChars: -1 }, { ...QA_POLICY, maxToolCalls: 1.5 }, { ...QA_POLICY, finalReserveMs: 0 }, { ...QA_POLICY, answerOutputTokens: 1 }, { ...QA_POLICY, version: "unknown" }])("rejects an invalid persisted budget instead of falling back", async budget => {
    await service.create(1, { commandId: "create", bookId: 1, selection, question: "解释" });
    db.prepare("UPDATE selection_qa_turns SET budget_json=?").run(JSON.stringify(budget));
    expect(() => runtime.claim("owner", Date.now())).toThrow("Invalid QA budget");
    expect(db.prepare("SELECT status,error_code FROM selection_qa_turns").get()).toEqual({ status: "failed", error_code: "INVALID_EXECUTION_SNAPSHOT" });
    expect(runtime.claim("owner", Date.now())).toBeNull();
    expect(db.prepare("SELECT count(*) n FROM selection_qa_events WHERE kind='terminal'").get()!.n).toBe(1);
  });
  it.each([null, {}, { ...snapshot, version: 2 }, { ...snapshot, providerId: "" }])("terminates invalid model snapshots before surfacing the error", async invalid => {
    await service.create(1, { commandId: "create", bookId: 1, selection, question: "解释" });
    db.prepare("UPDATE selection_qa_turns SET model_snapshot_json=?").run(JSON.stringify(invalid));
    expect(() => runtime.claim("owner", Date.now())).toThrow("Invalid QA model snapshot");
    expect(db.prepare("SELECT status,error_code FROM selection_qa_turns").get()).toEqual({ status: "failed", error_code: "INVALID_EXECUTION_SNAPSHOT" });
    expect(runtime.claim("owner", Date.now())).toBeNull();
  });
  it("records actual completed searches without a finish_research event, even on a limited turn", async () => {
    await service.create(1, { commandId: "create", bookId: 1, selection, question: "寻找依据" });
    const first = runtime.claim("owner", Date.now())!;
    runtime.phase(first, "executing", { operation: "search_book", state: "started", callId: "actual", arguments: { informationNeed: "依据", queries: { query1: "关键词", query2: "", query3: "", query4: "" } } });
    runtime.phase(first, "executing", { operation: "search_book", state: "completed", callId: "actual", informationNeed: "依据", queries: ["关键词"], resultCount: 1, results: [{ evidenceId: "e_candidate" }] });
    runtime.phase(first, "executing", { operation: "search_book", state: "started", callId: "unexecuted", informationNeed: "未执行", queries: ["不可记忆"] });
    runtime.finish(first, "failed", "RESEARCH_BUDGET_EXHAUSTED");
    service.addTurn(1, first.conversation.id, { commandId: "next", question: "追问" });
    const next = runtime.claim("owner", Date.now())!;
    expect(runtime.history(next).research).toEqual([{ turnId: first.turn.id, question: "寻找依据", informationNeed: "依据", queries: ["关键词"], resultCount: 1, selectedCandidateCount: null, unresolved: true }]);
  });
  it("does not mislabel resource-limited delivery as normal completion", async () => {
    await service.create(1, { commandId: "create", bookId: 1, selection, question: "解释" });
    const claim = runtime.claim("owner", Date.now())!;
    expect(() => runtime.finish(claim, "completed", "RESEARCH_BUDGET_EXHAUSTED")).toThrow("Completed QA turns cannot");
  });
  it("invalidates an earlier pass when an active answer version is replaced, even for identical text", async () => {
    await service.create(1, { commandId: "create", bookId: 1, selection, question: "解释" });
    const claim = runtime.claim("owner", Date.now())!;
    runtime.beginAnswer(claim, 1);
    runtime.append(claim, "答复", []);
    const fingerprint = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
    const judgment = { answerVersion: 1, generation: claim.generation, answerHash: fingerprint("答复"), evidenceFingerprint: fingerprint([]), inputFingerprint: fingerprint("input"), evidenceIds: [], revision: selection.scope, policy: "all-answers-v1" as const, verdict: "pass" as const, issues: [] };
    runtime.phase(claim, "checking", { operation: "context_usage", purpose: "quality_check", answerVersion: 1, inputFingerprint: judgment.inputFingerprint });
    runtime.quality(claim, judgment);
    runtime.evidence(claim, evidence("new-qualification"));
    expect(() => runtime.finish(claim, "completed", null)).toThrow("QUALITY_JUDGMENT_STALE");
    runtime.beginAnswer(claim, 2);
    runtime.append(claim, "答复", []);
    expect(() => runtime.quality(claim, judgment)).toThrow("QUALITY_JUDGMENT_STALE");
    expect(() => runtime.finish(claim, "completed", null)).toThrow("QUALITY_NOT_APPROVED");
    const records = new SqliteSelectionQaRepository({ getDatabase: () => db } as SqliteService);
    expect(records.turn(1, claim.turn.id)).toMatchObject({ status: "running", answerVersion: 2, answer: "答复" });
    expect(records.turn(1, claim.turn.id).quality).toBeUndefined();
  });
  it("pairs repeated model call IDs with the nearest preceding search start", async () => {
    await service.create(1, { commandId: "create", bookId: 1, selection, question: "分步查找" });
    const first = runtime.claim("owner", Date.now())!;
    runtime.phase(first, "retrieving", { operation: "search_book", state: "started", callId: "reused", informationNeed: "第一条线索", queries: ["旧词"] });
    runtime.phase(first, "retrieving", { operation: "search_book", state: "completed", callId: "reused", resultCount: 0 });
    runtime.phase(first, "retrieving", { operation: "search_book", state: "started", callId: "reused", informationNeed: "调整后的线索", queries: ["新词"] });
    runtime.phase(first, "retrieving", { operation: "search_book", state: "completed", callId: "reused", resultCount: 3 });
    finishHistorical(first);
    service.addTurn(1, first.conversation.id, { commandId: "next", question: "之前查到了什么" });
    const next = runtime.claim("owner", Date.now())!;
    expect(runtime.history(next).research).toEqual([
      { turnId: first.turn.id, question: "分步查找", informationNeed: "第一条线索", queries: ["旧词"], resultCount: 0, selectedCandidateCount: null, unresolved: true },
      { turnId: first.turn.id, question: "分步查找", informationNeed: "调整后的线索", queries: ["新词"], resultCount: 3, selectedCandidateCount: null, unresolved: false },
    ]);
  });
  it("freezes version changes as failure and fences every late operation", async () => {
    await service.create(1, { commandId: "create", bookId: 1, selection, question: "解释" });
    const claim = runtime.claim("owner", Date.now())!;
    runtime.append(claim, "已生成正文", []);
    const records = new SqliteSelectionQaRepository({ getDatabase: () => db } as SqliteService);
    records.transact(() => records.freeze(1, claim.conversation.id));
    expect(records.turn(1, claim.turn.id)).toMatchObject({ status: "failed", errorCode: "CONTENT_VERSION_CHANGED", answer: "已生成正文" });
    expect(db.prepare("SELECT lease_token,lease_owner,lease_expires_at FROM selection_qa_turns WHERE id=?").get(claim.turn.id))
      .toEqual({ lease_token: null, lease_owner: null, lease_expires_at: null });
    expect(() => runtime.append(claim, "迟到", [])).toThrow("LEASE_LOST");
    expect(() => runtime.evidence(claim, evidence("late"))).toThrow("LEASE_LOST");
    expect(() => runtime.finish(claim, "completed", null)).toThrow("LEASE_LOST");
  });
});
