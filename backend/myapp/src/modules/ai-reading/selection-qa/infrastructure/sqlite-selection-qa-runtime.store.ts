import { Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
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
} from "../application/selection-qa-runtime.port";
import { SqliteSelectionQaRepository } from "./sqlite-selection-qa.repository";
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
    return this.records.transact(() => {
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
      const snapshot = JSON.parse(
        String(row.model_snapshot_json),
      ) as QaModelSnapshot;
      if (
        snapshot.version !== 1 ||
        snapshot.policyVersion !== QA_POLICY.version
      )
        throw new Error(`Invalid QA model snapshot for ${turn.id}`);
      const token = randomUUID();
      this.db
        .prepare(
          "UPDATE selection_qa_turns SET status='running',lease_owner=?,lease_token=?,lease_generation=lease_generation+1,lease_expires_at=?,phase='context',updated_at=? WHERE id=? AND status='queued'",
        )
        .run(owner, token, now + QA_POLICY.leaseMs, now, turn.id);
      const generation = Number(
        this.db
          .prepare("SELECT lease_generation FROM selection_qa_turns WHERE id=?")
          .get(turn.id)!.lease_generation,
      );
      this.event(turn.userId, turn.id, "status", {
        status: "running",
        phase: "context",
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
        .run(now + QA_POLICY.leaseMs, c.turn.id);
    });
  }
  reserveModel(c: QaClaim, kind: "planning" | "protocol_repair" | "final"): void {
    this.mutate(c, Date.now(), () => {
      if (this.remaining(c).models <= 0)
        throw new SelectionQaError("MODEL_BUDGET_EXHAUSTED");
      const counter = this.db
        .prepare("SELECT model_call_count,protocol_repair_call_count FROM selection_qa_turns WHERE id=? AND user_id=?")
        .get(c.turn.id, c.turn.userId);
      if (!counter) throw new SelectionQaError("LEASE_LOST");
      const used = Number(kind === "protocol_repair" ? counter.protocol_repair_call_count : counter.model_call_count);
      const limit = kind === "protocol_repair"
        ? QA_POLICY.maxProtocolRepairAttempts
        : kind === "planning"
          ? QA_POLICY.maxPlanningCalls
          : QA_POLICY.maxPlanningCalls + 1;
      if (!Number.isSafeInteger(used) || used >= limit)
        throw new SelectionQaError("MODEL_BUDGET_EXHAUSTED");
      this.db
        .prepare(
          kind === "protocol_repair"
            ? "UPDATE selection_qa_turns SET protocol_repair_call_count=protocol_repair_call_count+1 WHERE id=?"
            : "UPDATE selection_qa_turns SET model_call_count=model_call_count+1 WHERE id=?",
        )
        .run(c.turn.id);
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
  remaining(c: QaClaim) {
    const row = this.db
      .prepare(
        "SELECT model_call_count,protocol_repair_call_count,tool_call_count,read_char_count FROM selection_qa_turns WHERE id=? AND user_id=?",
      )
      .get(c.turn.id, c.turn.userId);
    if (!row) throw new SelectionQaError("LEASE_LOST");
    return {
      models: QA_POLICY.maxModelCalls - Number(row.model_call_count) - Number(row.protocol_repair_call_count),
      tools: QA_POLICY.maxToolCalls - Number(row.tool_call_count),
      chars: QA_POLICY.maxReadChars - Number(row.read_char_count),
    };
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
  append(c: QaClaim, text: string, citations: QaSavedEvidence[]): void {
    let first = false;
    this.mutate(c, Date.now(), () => {
      for (const evidence of citations)
        this.event(c.turn.userId, c.turn.id, "citation", { evidence });
      if (text) {
        const row = this.db
          .prepare("SELECT answer FROM selection_qa_turns WHERE id=?")
          .get(c.turn.id)!;
        first = String(row.answer).length === 0;
        if (String(row.answer).length + text.length > QA_POLICY.maxAnswerChars)
          throw new SelectionQaError("OUTPUT_CHARACTER_LIMIT");
        this.db
          .prepare(
            "UPDATE selection_qa_turns SET answer=answer||?,updated_at=? WHERE id=?",
          )
          .run(text, Date.now(), c.turn.id);
        this.event(c.turn.userId, c.turn.id, "answer_delta", { text });
      }
    });
    if (first) this.logger.log({ event: "selection_qa.persisted_first_delta", turnId: c.turn.id, at: Date.now(), sinceCreatedMs: Date.now() - c.turn.createdAt });
  }
  finish(
    c: QaClaim,
    status: "completed" | "failed" | "timed_out",
    reason: string | null,
  ): void {
    const phase = this.records.turn(c.turn.userId, c.turn.id).phase;
    this.mutate(c, Date.now(), () => this.terminal(c.turn.userId, c.turn.id, status, reason));
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
          json_extract(start.payload_json, '$.informationNeed') AS information_need,
          json_extract(start.payload_json, '$.queries') AS queries,
          json_extract(done.payload_json, '$.resultCount') AS result_count,
          json_extract(done.payload_json, '$.results') AS candidate_results,
          json_extract(decision.payload_json, '$.selectedEvidenceIds') AS selected_ids,
          json_array_length(json_extract(decision.payload_json, '$.insufficientEvidence')) AS missing
        FROM selection_qa_turns t
        JOIN selection_qa_events start ON start.turn_id=t.id AND start.user_id=t.user_id
        JOIN selection_qa_events done ON done.turn_id=t.id AND done.user_id=t.user_id
          AND json_extract(done.payload_json, '$.callId')=json_extract(start.payload_json, '$.callId')
        JOIN selection_qa_events decision ON decision.turn_id=t.id AND decision.user_id=t.user_id
        WHERE t.conversation_id=? AND t.user_id=? AND t.turn_number<? AND t.status='completed'
          AND start.kind='status' AND json_extract(start.payload_json, '$.operation')='search_book'
          AND json_extract(start.payload_json, '$.state')='started'
          AND done.kind='status' AND json_extract(done.payload_json, '$.operation')='search_book'
          AND json_extract(done.payload_json, '$.state')='completed'
          AND decision.kind='status' AND json_extract(decision.payload_json, '$.operation')='finish_research'
          AND json_extract(decision.payload_json, '$.state')='completed'
        ORDER BY t.turn_number, start.sequence
      `).all(c.turn.conversationId, c.turn.userId, c.turn.turnNumber).map(row => {
        const results = row.candidate_results === null ? null : JSON.parse(String(row.candidate_results)) as Array<{ evidenceId?: string }>;
        const selectedIds = row.selected_ids === null ? null : JSON.parse(String(row.selected_ids)) as string[];
        const identifiable = results !== null && selectedIds !== null && results.every(item => typeof item.evidenceId === "string");
        const selectedCandidateCount = identifiable
          ? results.filter(item => selectedIds.includes(item.evidenceId!)).length
          : null;
        return {
          turnId: String(row.id), question: String(row.question).slice(0, 1000),
          informationNeed: String(row.information_need), queries: JSON.parse(String(row.queries)) as string[],
          resultCount: Number(row.result_count), selectedCandidateCount,
          unresolved: Number(row.missing) > 0 || (selectedCandidateCount === null ? Number(row.result_count) === 0 : selectedCandidateCount === 0),
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
    this.event(userId, id, "terminal", { status, reason, answer: turn.answer });
  }
}
