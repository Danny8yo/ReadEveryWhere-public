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
  async function previous(citations: string[], missing = false) {
    await service.create(1, { commandId: "create", bookId: 1, selection, question: "解释" });
    const first = runtime.claim("owner", Date.now())!;
    for (const id of ["e_000_rejected", "e_001_rejected", ...citations]) if (!missing || id !== citations[0]) runtime.evidence(first, evidence(id));
    runtime.append(first, "回答", citations.map(evidence)); runtime.finish(first, "completed", null);
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
    runtime.finish(first, "completed", null);
    for (let n = 0; n < 4; n++) {
      service.addTurn(1, first.conversation.id, { commandId: `middle-${n}`, question: "解释其他概念" });
      const c = runtime.claim("owner", Date.now())!;
      runtime.finish(c, "completed", null);
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
    runtime.finish(first, "completed", null);
    service.addTurn(1, first.conversation.id, { commandId: "next", question: "追问" });
    const next = runtime.claim("owner", Date.now())!;
    expect(runtime.history(next).research).toMatchObject([
      { resultCount: 20, selectedCandidateCount: 0, unresolved: true },
      { resultCount: 2, selectedCandidateCount: 1, unresolved: false },
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
  it("keeps the persisted final-answer slot after all ordinary planning calls are used", async () => {
    await service.create(1, { commandId: "create", bookId: 1, selection, question: "解释" });
    const claim = runtime.claim("owner", Date.now())!;
    for (let count = 0; count < QA_POLICY.maxPlanningCalls; count++)
      runtime.reserveModel(claim, "planning");

    expect(() => runtime.reserveModel(claim, "planning")).toThrow(
      expect.objectContaining({ code: "MODEL_BUDGET_EXHAUSTED" }),
    );
    expect(runtime.remaining(claim).models).toBe(3);

    runtime.reserveModel(claim, "final");
    expect(
      db.prepare("SELECT model_call_count,protocol_repair_call_count FROM selection_qa_turns WHERE id=?")
        .get(claim.turn.id),
    ).toMatchObject({ model_call_count: 4, protocol_repair_call_count: 0 });
    expect(() => runtime.reserveModel(claim, "final")).toThrow(
      expect.objectContaining({ code: "MODEL_BUDGET_EXHAUSTED" }),
    );
  });
});
