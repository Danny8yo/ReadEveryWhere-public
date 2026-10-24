import { Logger } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { SqliteService } from "../../../../platform/persistence/sqlite/sqlite.service";
import {
  SelectionQaError,
  SelectionQaContentPort,
  Turn,
} from "../application/selection-qa.types";
import {
  QA_POLICY,
  QaRuntimeStore,
  QaClaim,
  QaModelSnapshot,
  QaUsage,
  QaSavedEvidence,
  QaQualityJudgment,
} from "../application/selection-qa-runtime.port";
import { SqliteSelectionQaRepository } from "./sqlite-selection-qa.repository";
class InvalidQaExecutionSnapshot extends Error {}

export class SqliteSelectionQaRuntimeStore implements QaRuntimeStore {
  private readonly logger = new Logger(SqliteSelectionQaRuntimeStore.name);
  constructor(
    private readonly sqlite: SqliteService,
    private readonly records: SqliteSelectionQaRepository,
    private readonly content: SelectionQaContentPort,
  ) {}
  private get db() {
    return this.sqlite.getDatabase();
  }
  maintain(now: number): void {
    this.records.transact(() => {
      for (const row of this.db
        .prepare(
          "SELECT id,user_id,deadline,status,lease_expires_at FROM selection_qa_turns WHERE status IN ('queued','running') AND (deadline<=? OR (status='running' AND lease_expires_at<=?))",
        )
        .all(now, now)) {
        this.terminal(
          Number(row.user_id),
          String(row.id),
          Number(row.deadline) <= now ? "timed_out" : "failed",
          Number(row.deadline) <= now
            ? "DEADLINE_EXCEEDED"
            : "worker_interrupted",
        );
      }
    });
  }
  claim(owner: string, now: number): QaClaim | null {
    const result = this.records.transact<QaClaim | { snapshotError: Error } | null>(() => {
      const row = this.db
        .prepare(
          "SELECT id,user_id,model_snapshot_json FROM selection_qa_turns WHERE status='queued' AND deadline>? ORDER BY created_at,id LIMIT 1",
        )
        .get(now);
      if (!row) return null;
      const turn = this.records.turn(Number(row.user_id), String(row.id));
      const conversation = this.records.conversation(
        turn.userId,
        turn.conversationId,
      );
      try {
        this.content.assertCurrent(turn.userId, conversation.selection);
      } catch (error) {
        if (
          error instanceof SelectionQaError &&
          error.code === "CONTENT_VERSION_CHANGED"
        ) {
          this.records.freeze(turn.userId, conversation.id);
          return null;
        }
        throw error;
      }
      if (row.model_snapshot_json === null) {
        this.terminal(
          turn.userId,
          turn.id,
          "failed",
          "EXECUTION_NOT_CONFIGURED",
        );
        return null;
      }
      let policy: typeof QA_POLICY;
      let snapshot: QaModelSnapshot;
      try {
        policy = this.policy(turn.userId, turn.id);
        const value: unknown = JSON.parse(String(row.model_snapshot_json));
        if (typeof value !== "object" || value === null || Array.isArray(value))
          throw new InvalidQaExecutionSnapshot(`Invalid QA model snapshot for ${turn.id}`);
        snapshot = value as QaModelSnapshot;
        if (snapshot.version !== 1 || snapshot.policyVersion !== QA_POLICY.version ||
          [snapshot.providerId, snapshot.modelId, snapshot.tokenizerId].some(v => typeof v !== "string" || v.length === 0) ||
          [snapshot.contextWindowTokens, snapshot.maxOutputTokens].some(v => !Number.isSafeInteger(v) || v <= 0))
          throw new InvalidQaExecutionSnapshot(`Invalid QA model snapshot for ${turn.id}`);
      } catch (error) {
        if (!(error instanceof InvalidQaExecutionSnapshot)) throw error;
        this.terminal(turn.userId, turn.id, "failed", "INVALID_EXECUTION_SNAPSHOT");
        return { snapshotError: error };
      }
      const token = randomUUID();
      this.db
        .prepare(
          "UPDATE selection_qa_turns SET status='running',lease_owner=?,lease_token=?,lease_generation=lease_generation+1,lease_expires_at=?,phase='deciding',updated_at=? WHERE id=? AND status='queued'",
        )
        .run(owner, token, now + policy.leaseMs, now, turn.id);
      const generation = Number(
        this.db
          .prepare("SELECT lease_generation FROM selection_qa_turns WHERE id=?")
          .get(turn.id)!.lease_generation,
      );
      this.event(turn.userId, turn.id, "status", {
        status: "running",
        phase: "deciding",
      });
      return {
        turn: this.records.turn(turn.userId, turn.id),
        conversation,
        snapshot,
        token,
        generation,
        owner,
      };
    });
    // Persist the terminal before surfacing the error to the scheduler. A bad
    // queued row must not repeatedly block all valid work behind it.
    if (result && "snapshotError" in result) throw result.snapshotError;
    return result;
  }
  mutate<T>(claim: QaClaim, now: number, action: () => T): T {
    const outcome = this.records.transact(() => {
      const row = this.db
        .prepare(
          "SELECT deadline,lease_expires_at FROM selection_qa_turns WHERE id=? AND user_id=? AND status='running' AND lease_owner=? AND lease_token=? AND lease_generation=?",
        )
        .get(
          claim.turn.id,
          claim.turn.userId,
          claim.owner,
          claim.token,
          claim.generation,
        );
      if (!row || Number(row.lease_expires_at) <= now)
        throw new SelectionQaError("LEASE_LOST");
      if (Number(row.deadline) <= now) {
        this.terminal(
          claim.turn.userId,
          claim.turn.id,
          "timed_out",
          "DEADLINE_EXCEEDED",
        );
        return { error: new SelectionQaError("DEADLINE_EXCEEDED") };
      }
      try {
        this.content.assertCurrent(
          claim.turn.userId,
          claim.conversation.selection,
        );
      } catch (error) {
        if (
          error instanceof SelectionQaError &&
          error.code === "CONTENT_VERSION_CHANGED"
        ) {
          this.records.freeze(claim.turn.userId, claim.conversation.id);
          return { error };
        }
        throw error;
      }
      return { value: action() };
    });
    if ("error" in outcome) throw outcome.error;
    return outcome.value;
  }
  renew(c: QaClaim, now: number): void {
    this.mutate(c, now, () => {
      this.db
        .prepare("UPDATE selection_qa_turns SET lease_expires_at=? WHERE id=?")
        .run(now + this.policy(c.turn.userId, c.turn.id).leaseMs, c.turn.id);
    });
  }
  reserveModel(c: QaClaim, kind: "decision" | "final" | "check"): void {
    this.mutate(c, Date.now(), () => {
      if (this.remaining(c).models <= (kind === "decision" ? 2 : kind === "final" ? 1 : 0))
        throw new SelectionQaError("MODEL_BUDGET_EXHAUSTED");
      this.db.prepare("UPDATE selection_qa_turns SET model_call_count=model_call_count+1 WHERE id=?").run(c.turn.id);
    });
  }
  reserveTool(c: QaClaim): number {
    return this.mutate(c, Date.now(), () => {
      const remaining = this.remaining(c);
      if (remaining.tools <= 0 || remaining.chars <= 0)
        throw new SelectionQaError("TOOL_BUDGET_EXHAUSTED");
      this.db
        .prepare(
          "UPDATE selection_qa_turns SET tool_call_count=tool_call_count+1 WHERE id=?",
        )
        .run(c.turn.id);
      return remaining.chars;
    });
  }
  chargeRead(c: QaClaim, chars: number): void {
    this.mutate(c, Date.now(), () => {
      if (
        !Number.isSafeInteger(chars) ||
        chars < 0 ||
        chars > this.remaining(c).chars
      )
        throw new SelectionQaError("READ_BUDGET_EXHAUSTED");
      this.db
        .prepare(
          "UPDATE selection_qa_turns SET read_char_count=read_char_count+? WHERE id=?",
        )
        .run(chars, c.turn.id);
    });
  }
  /** Frozen per-turn limits are the execution authority; globals are only safety ceilings. */
  private policy(userId: number, turnId: string): typeof QA_POLICY {
    const row = this.db.prepare("SELECT budget_json FROM selection_qa_turns WHERE id=? AND user_id=?").get(turnId, userId);
    if (!row) throw new SelectionQaError("LEASE_LOST");
    const value: unknown = JSON.parse(String(row.budget_json));
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new InvalidQaExecutionSnapshot(`Invalid QA budget snapshot for ${turnId}`);
    const policy = value as Record<string, unknown>;
    if (policy.version !== QA_POLICY.version)
      throw new InvalidQaExecutionSnapshot(`Invalid QA budget policy version for ${turnId}`);
    const frozenLimits = new Set(["maxModelCalls", "maxToolCalls", "maxReadChars", "maxAnswerChars", "leaseMs"]);
    for (const [key, ceiling] of Object.entries(QA_POLICY)) {
      if (typeof ceiling !== "number") continue;
      const limit = policy[key];
      if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 0 || limit > ceiling)
        throw new InvalidQaExecutionSnapshot(`Invalid QA budget ${key} for ${turnId}`);
      // The application uses these versioned timing/output settings directly;
      // reject a drifted snapshot instead of accepting a value it would ignore.
      if (!frozenLimits.has(key) && limit !== ceiling)
        throw new InvalidQaExecutionSnapshot(`Invalid QA budget policy setting ${key} for ${turnId}`);
    }
    if (Number(policy.maxModelCalls) < 3 || Number(policy.maxAnswerChars) < 1 || Number(policy.leaseMs) < 1)
      throw new InvalidQaExecutionSnapshot(`Invalid QA budget reservation limits for ${turnId}`);
    return value as typeof QA_POLICY;
  }
  remaining(c: QaClaim) {
    const policy = this.policy(c.turn.userId, c.turn.id);
    const row = this.db.prepare(
      "SELECT model_call_count,tool_call_count,read_char_count FROM selection_qa_turns WHERE id=? AND user_id=?",
    ).get(c.turn.id, c.turn.userId);
    if (!row) throw new SelectionQaError("LEASE_LOST");
    const remaining = {
      models: policy.maxModelCalls - Number(row.model_call_count),
      tools: policy.maxToolCalls - Number(row.tool_call_count),
      chars: policy.maxReadChars - Number(row.read_char_count),
    };
    if (Object.values(remaining).some(n => !Number.isSafeInteger(n) || n < 0))
      throw new Error(`Invalid QA persisted budget counters for ${c.turn.id}`);
    return remaining;
  }
  phase(
    c: QaClaim,
    phase: string,
    details: Record<string, unknown> = {},
  ): void {
    this.mutate(c, Date.now(), () => {
      this.db
        .prepare(
          "UPDATE selection_qa_turns SET phase=?,updated_at=? WHERE id=?",
        )
        .run(phase, Date.now(), c.turn.id);
      this.event(c.turn.userId, c.turn.id, "status", {
        status: "running",
        phase,
        at: Date.now(),
        ...details,
      });
    });
  }
  usage(c: QaClaim, usage: QaUsage, maxOutputTokens: number): void {
    this.mutate(c, Date.now(), () => {
      if (
        [usage.promptTokens, usage.completionTokens, usage.totalTokens].some((n) => !Number.isSafeInteger(n) || n < 0) ||
        usage.totalTokens !== usage.promptTokens + usage.completionTokens
      )
        throw new SelectionQaError("MODEL_USAGE_INVALID");
      if (usage.completionTokens > maxOutputTokens)
        throw new SelectionQaError("MODEL_OUTPUT_BUDGET_EXCEEDED");
      const row = this.db
        .prepare("SELECT usage_json FROM selection_qa_turns WHERE id=?")
        .get(c.turn.id)!;
      const old = JSON.parse(String(row.usage_json)) as QaUsage;
      this.db
        .prepare("UPDATE selection_qa_turns SET usage_json=? WHERE id=?")
        .run(
          JSON.stringify({
            promptTokens: old.promptTokens + usage.promptTokens,
            completionTokens: old.completionTokens + usage.completionTokens,
            totalTokens: old.totalTokens + usage.totalTokens,
          }),
          c.turn.id,
        );
    });
  }
  evidence(c: QaClaim, e: QaSavedEvidence): void {
    this.mutate(c, Date.now(), () => {
      this.db
        .prepare(
          "INSERT INTO selection_qa_evidence(turn_id,user_id,evidence_id,source_kind,evidence_json) VALUES(?,?,?,'book',?)",
        )
        .run(c.turn.id, c.turn.userId, e.evidenceId, JSON.stringify(e));
    });
  }
  beginAnswer(c: QaClaim, version: number): void {
    this.mutate(c, Date.now(), () => {
      const current = this.records.turn(c.turn.userId, c.turn.id);
      if (version !== (current.answerVersion ?? 0) + 1 || version > QA_POLICY.maxAnswerVersions)
        throw new SelectionQaError("ANSWER_VERSION_INVALID");
      this.db.prepare("UPDATE selection_qa_turns SET answer='',phase='answer',updated_at=? WHERE id=?").run(Date.now(), c.turn.id);
      this.event(c.turn.userId, c.turn.id, "status", { status: "running", phase: "answer", at: Date.now(), operation: "answer_version", state: "started", answerVersion: version });
    });
  }
  quality(c: QaClaim, value: QaQualityJudgment): void {
    this.mutate(c, Date.now(), () => {
      const turn = this.records.turn(c.turn.userId, c.turn.id);
      this.assertJudgment(c, turn, value);
      this.event(c.turn.userId, c.turn.id, "status", { status: "running", phase: "checking", at: Date.now(), operation: "quality_check", state: "completed", answerVersion: value.answerVersion, judgment: value });
    });
  }
  private assertJudgment(c: QaClaim, turn: Turn, value: QaQualityJudgment): void {
    const inputRecord = this.db.prepare("SELECT payload_json FROM selection_qa_events WHERE turn_id=? AND user_id=? AND kind='status' AND json_extract(payload_json,'$.operation')='context_usage' AND json_extract(payload_json,'$.purpose')='quality_check' ORDER BY sequence DESC LIMIT 1").get(c.turn.id, c.turn.userId);
    if (!inputRecord) throw new SelectionQaError("QUALITY_JUDGMENT_STALE");
    const recorded = JSON.parse(String(inputRecord.payload_json));
    if (recorded.answerVersion !== value.answerVersion || recorded.inputFingerprint !== value.inputFingerprint) throw new SelectionQaError("QUALITY_JUDGMENT_STALE");
    const registered = this.db.prepare("SELECT evidence_id FROM selection_qa_evidence WHERE turn_id=? AND user_id=? ORDER BY evidence_id").all(c.turn.id, c.turn.userId).map(row => String(row.evidence_id));
    if (new Set(value.evidenceIds).size !== value.evidenceIds.length || JSON.stringify(registered) !== JSON.stringify([...value.evidenceIds].sort())) throw new SelectionQaError("QUALITY_JUDGMENT_STALE");
    const evidence = value.evidenceIds.map(id => this.records.findEvidence(c.turn.userId, c.turn.id, id));
    if (value.answerVersion !== turn.answerVersion || value.generation !== c.generation ||
      value.answerHash !== createHash("sha256").update(turn.answer).digest("hex") ||
      value.evidenceFingerprint !== createHash("sha256").update(JSON.stringify(evidence)).digest("hex") ||
      JSON.stringify(value.revision) !== JSON.stringify(c.conversation.selection.scope) ||
      !/^[a-f0-9]{64}$/.test(value.inputFingerprint) || !/^[a-f0-9]{64}$/.test(value.evidenceFingerprint))
      throw new SelectionQaError("QUALITY_JUDGMENT_STALE");
  }
  append(c: QaClaim, text: string, citations: QaSavedEvidence[]): void {
    let first = false;
    this.mutate(c, Date.now(), () => {
      for (const evidence of citations)
        this.event(c.turn.userId, c.turn.id, "citation", { evidence, answerVersion: this.records.turn(c.turn.userId, c.turn.id).answerVersion });
      if (text) {
        const row = this.db
          .prepare("SELECT answer FROM selection_qa_turns WHERE id=?")
          .get(c.turn.id)!;
        first = String(row.answer).length === 0;
        if (String(row.answer).length + text.length > this.policy(c.turn.userId, c.turn.id).maxAnswerChars)
          throw new SelectionQaError("OUTPUT_CHARACTER_LIMIT");
        this.db
          .prepare(
            "UPDATE selection_qa_turns SET answer=answer||?,updated_at=? WHERE id=?",
          )
          .run(text, Date.now(), c.turn.id);
        this.event(c.turn.userId, c.turn.id, "answer_delta", { text, answerVersion: this.records.turn(c.turn.userId, c.turn.id).answerVersion });
      }
    });
    if (first) this.logger.log({ event: "selection_qa.persisted_first_delta", turnId: c.turn.id, at: Date.now(), sinceCreatedMs: Date.now() - c.turn.createdAt });
  }
  finish(
    c: QaClaim,
    status: "completed" | "failed" | "timed_out",
    reason: string | null,
  ): void {
    if (status === "completed" && reason !== null)
      throw new Error("Completed QA turns cannot carry a failure or resource-limit reason");
    const phase = this.records.turn(c.turn.userId, c.turn.id).phase;
    this.mutate(c, Date.now(), () => {
      if (status === "completed") {
        const turn = this.records.turn(c.turn.userId, c.turn.id);
        if (!turn.quality || turn.quality.verdict !== "pass") throw new SelectionQaError("QUALITY_NOT_APPROVED");
        this.assertJudgment(c, turn, turn.quality);
      }
      this.terminal(c.turn.userId, c.turn.id, status, reason);
    });
    if (status !== "completed") this.logger.warn({ event: "selection_qa.terminal", turnId: c.turn.id, phase, status, reason });
  }
  history(c: QaClaim) {
    return this.mutate(c, Date.now(), () => {
      const turns = this.db
        .prepare(
          "SELECT id,question,answer,status FROM selection_qa_turns WHERE conversation_id=? AND user_id=? AND turn_number<? ORDER BY turn_number",
        )
        .all(c.turn.conversationId, c.turn.userId, c.turn.turnNumber)
        .map(row => ({ id: String(row.id), question: String(row.question), answer: String(row.answer), status: String(row.status) as Turn["status"] }));
      const historicalEvidence = turns.slice(-3)
        .map(turn => this.records.turn(c.turn.userId, turn.id))
        .flatMap(turn => turn.citations.map(citation => ({ turnId: turn.id, evidenceId: citation.evidenceId })))
        .slice(-2)
        .map(({ turnId, evidenceId }) => {
          const row = this.db.prepare(
            "SELECT evidence_json FROM selection_qa_evidence WHERE turn_id=? AND user_id=? AND evidence_id=?",
          ).get(turnId, c.turn.userId, evidenceId);
          if (!row) throw new Error(`Persisted citation has no evidence: turn=${turnId}, evidence=${evidenceId}`);
          return { ...JSON.parse(String(row.evidence_json)), turnId } as QaSavedEvidence & { turnId: string };
        });
      // Read compact facts only: never replay candidate text to remember a search.
      const research = this.db.prepare(`
        SELECT t.id, t.question,
          COALESCE(json_extract(done.payload_json, '$.informationNeed'),json_extract(start.payload_json, '$.informationNeed')) AS information_need,
          COALESCE(json_extract(done.payload_json, '$.queries'),json_extract(start.payload_json, '$.queries')) AS queries,
          json_extract(done.payload_json, '$.resultCount') AS result_count,
          json_extract(done.payload_json, '$.results') AS candidate_results,
          json_extract(done.payload_json, '$.searchId') AS search_id,
          json_extract(decision.payload_json, '$.selectedEvidenceIds') AS selected_ids,
          json_array_length(json_extract(decision.payload_json, '$.insufficientEvidence')) AS missing,
          t.error_code
        FROM selection_qa_turns t
        JOIN selection_qa_events start ON start.turn_id=t.id AND start.user_id=t.user_id
        JOIN selection_qa_events done ON done.turn_id=t.id AND done.user_id=t.user_id
          AND json_extract(done.payload_json, '$.callId')=json_extract(start.payload_json, '$.callId')
          AND done.sequence>start.sequence
          AND NOT EXISTS (
            SELECT 1 FROM selection_qa_events later_start
            WHERE later_start.turn_id=t.id AND later_start.user_id=t.user_id
              AND later_start.sequence>start.sequence AND later_start.sequence<done.sequence
              AND later_start.kind='status'
              AND json_extract(later_start.payload_json, '$.operation')='search_book'
              AND json_extract(later_start.payload_json, '$.state')='started'
              AND json_extract(later_start.payload_json, '$.callId')=json_extract(done.payload_json, '$.callId')
          )
        LEFT JOIN selection_qa_events decision ON decision.turn_id=t.id AND decision.user_id=t.user_id
          AND decision.kind='status' AND json_extract(decision.payload_json, '$.operation')='finish_research'
          AND json_extract(decision.payload_json, '$.state')='completed'
        WHERE t.conversation_id=? AND t.user_id=? AND t.turn_number<? AND t.status IN ('completed','failed','cancelled','timed_out')
          AND start.kind='status' AND json_extract(start.payload_json, '$.operation')='search_book'
          AND json_extract(start.payload_json, '$.state')='started'
          AND done.kind='status' AND json_extract(done.payload_json, '$.operation')='search_book'
          AND json_extract(done.payload_json, '$.state')='completed'
        ORDER BY t.turn_number, start.sequence
      `).all(c.turn.conversationId, c.turn.userId, c.turn.turnNumber).map(row => {
        // Reranked searches can deliver further pages of the same pool through more_search_results.
        const pages = row.search_id === null ? [] : (this.db.prepare(`SELECT json_extract(payload_json,'$.results') AS results FROM selection_qa_events
          WHERE turn_id=? AND user_id=? AND kind='status' AND json_extract(payload_json,'$.operation')='search_more'
            AND json_extract(payload_json,'$.state')='completed' AND json_extract(payload_json,'$.searchId')=? ORDER BY sequence`)
          .all(row.id, c.turn.userId, row.search_id) as Array<{ results: string | null }>).map(page => {
            if (page.results === null) throw new Error(`search_more page without results: turn=${String(row.id)}`);
            return JSON.parse(page.results) as Array<{ evidenceId?: string }>;
          });
        const first = row.candidate_results === null ? null : JSON.parse(String(row.candidate_results)) as Array<{ evidenceId?: string }>;
        const results = first === null ? null : [...first, ...pages.flat()];
        const selectedIds = row.selected_ids === null ? null : JSON.parse(String(row.selected_ids)) as string[];
        const identifiable = results !== null && selectedIds !== null && results.every(item => typeof item.evidenceId === "string");
        const selectedCandidateCount = identifiable
          ? results.filter(item => selectedIds.includes(item.evidenceId!)).length
          : null;
        return {
          turnId: String(row.id), question: String(row.question).slice(0, 1000),
          informationNeed: String(row.information_need), queries: JSON.parse(String(row.queries)) as string[],
          resultCount: Number(row.result_count) + pages.reduce((n, page) => n + page.length, 0), selectedCandidateCount,
          unresolved: Number(row.missing) > 0 || ["RESEARCH_BUDGET_EXHAUSTED", "NO_PROGRESS", "INPUT_TOKEN_LIMIT"].includes(String(row.error_code)) || (selectedCandidateCount === null ? Number(row.result_count) === 0 : selectedCandidateCount === 0),
        };
      });
      return { turns, historicalEvidence, research };
    });
  }
  private event(
    userId: number,
    id: string,
    kind: string,
    payload: unknown,
  ): void {
    this.db
      .prepare(
        "UPDATE selection_qa_turns SET last_sequence=last_sequence+1 WHERE id=?",
      )
      .run(id);
    const sequence = this.db
      .prepare("SELECT last_sequence FROM selection_qa_turns WHERE id=?")
      .get(id)!.last_sequence;
    this.db
      .prepare("INSERT INTO selection_qa_events VALUES(?,?,?,?,?,?)")
      .run(id, userId, sequence, kind, JSON.stringify(payload), Date.now());
    this.records.eventsChanged(userId, id);
  }
  private terminal(
    userId: number,
    id: string,
    status: string,
    reason: string | null,
  ): void {
    const turn = this.records.turn(userId, id);
    if (!["queued", "running"].includes(turn.status)) return;
    this.db
      .prepare(
        "UPDATE selection_qa_turns SET status=?,error_code=?,phase='terminal',lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,lease_generation=lease_generation+1,updated_at=? WHERE id=?",
      )
      .run(status, reason, Date.now(), id);
    this.event(userId, id, "terminal", { status, reason, answer: turn.answer, answerVersion: turn.answerVersion, quality: turn.quality });
  }
}
