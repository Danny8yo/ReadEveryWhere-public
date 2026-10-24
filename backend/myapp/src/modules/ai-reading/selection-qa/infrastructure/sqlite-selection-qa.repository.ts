import { randomUUID, createHash } from "node:crypto";
import {
  QA_POLICY,
  type QaClaim,
  type QaModelSnapshot,
  type QaRuntimeStore,
  type QaUsage,
  type QaSavedEvidence,
} from "../application/selection-qa-runtime.port";
import { Injectable } from "@nestjs/common";
import { SqliteService } from "../../../../platform/persistence/sqlite/sqlite.service";
import {
  CommandResult,
  SelectionQaEvent,
  Conversation,
  Turn,
  SelectionQaError,
  SelectionQaStore,
} from "../application/selection-qa.types";
@Injectable()
export class SqliteSelectionQaRepository implements SelectionQaStore {
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly changed = new Set<string>();
  constructor(private readonly sqlite: SqliteService) {}
  subscribe(userId: number, id: string, listener: () => void): () => void {
    const key = `${userId}:${id}`;
    let listeners = this.listeners.get(key);
    if (!listeners) this.listeners.set(key, listeners = new Set());
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(key);
    };
  }
  eventsChanged(userId: number, id: string): void {
    if (!this.db.isTransaction) throw new Error("QA events must be written in a transaction");
    this.changed.add(`${userId}:${id}`);
  }
  private get db() {
    return this.sqlite.getDatabase();
  }
  transact<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      const changed = [...this.changed];
      this.changed.clear();
      // Never notify before commit, or run socket callbacks inside the SQLite transaction.
      for (const key of changed) queueMicrotask(() => {
        for (const listener of this.listeners.get(key) ?? []) listener();
      });
      return result;
    } catch (error) {
      this.changed.clear();
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw error;
    }
  }
  receipt(userId: number, id: string, digest: string): CommandResult | null {
    const row = this.db
      .prepare(
        "SELECT * FROM selection_qa_commands WHERE user_id=? AND command_id=?",
      )
      .get(userId, id);
    if (!row) return null;
    if (row.request_digest !== digest)
      throw new SelectionQaError("COMMAND_PAYLOAD_MISMATCH");
    return JSON.parse(String(row.result_json));
  }
  saveReceipt(
    userId: number,
    id: string,
    digest: string,
    result: CommandResult,
  ): void {
    this.db
      .prepare("INSERT INTO selection_qa_commands VALUES(?,?,?,?,?)")
      .run(userId, id, digest, JSON.stringify(result), Date.now());
  }
  conversation(userId: number, id: string): Conversation {
    const row = this.db
      .prepare(
        "SELECT * FROM selection_qa_conversations WHERE user_id=? AND id=?",
      )
      .get(userId, id);
    if (!row) throw new SelectionQaError("CONVERSATION_NOT_FOUND", 404);
    return this.mapConversation(row);
  }
  turn(userId: number, id: string): Turn {
    const row = this.db
      .prepare("SELECT * FROM selection_qa_turns WHERE user_id=? AND id=?")
      .get(userId, id);
    if (!row) throw new SelectionQaError("TURN_NOT_FOUND", 404);
    return this.mapTurn(row);
  }
  createConversation(v: Conversation): void {
    this.db
      .prepare(
        "INSERT INTO selection_qa_conversations(id,user_id,book_id,selection_json,status,frozen_reason,first_question,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        v.id,
        v.userId,
        v.bookId,
        JSON.stringify(v.selection),
        v.status,
        v.frozenReason,
        v.firstQuestion,
        v.createdAt,
        v.updatedAt,
      );
  }
  createTurn(v: Turn, snapshot: QaModelSnapshot): void {
    this.db
      .prepare(
        "INSERT INTO selection_qa_turns(id,user_id,conversation_id,turn_number,question,answer,status,error_code,retry_of_turn_id,deadline,last_sequence,created_at,updated_at,model_snapshot_json,budget_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        v.id,
        v.userId,
        v.conversationId,
        v.turnNumber,
        v.question,
        v.answer,
        v.status,
        v.errorCode,
        v.retryOfTurnId,
        v.deadline,
        v.lastSequence,
        v.createdAt,
        v.updatedAt,
        JSON.stringify(snapshot),
        JSON.stringify(QA_POLICY),
      );
    this.event(v.userId, v.id, "status", { status: v.status });
  }
  activeTurn(userId: number, id: string): Turn | null {
    const row = this.db
      .prepare(
        "SELECT * FROM selection_qa_turns WHERE user_id=? AND conversation_id=? AND status IN ('queued','running')",
      )
      .get(userId, id);
    return row ? this.mapTurn(row) : null;
  }
  nextTurnNumber(userId: number, id: string): number {
    return Number(
      this.db
        .prepare(
          "SELECT COALESCE(MAX(turn_number),0)+1 n FROM selection_qa_turns WHERE user_id=? AND conversation_id=?",
        )
        .get(userId, id)!.n,
    );
  }
  freeze(userId: number, id: string): void {
    this.db
      .prepare(
        "UPDATE selection_qa_conversations SET status='frozen',frozen_reason='CONTENT_VERSION_CHANGED',updated_at=? WHERE user_id=? AND id=?",
      )
      .run(Date.now(), userId, id);
    const active = this.activeTurn(userId, id);
    if (active) this.stop(userId, active.id, "CONTENT_VERSION_CHANGED");
  }
  stop(userId: number, id: string, reason = "USER_STOPPED"): Turn {
    const current = this.turn(userId, id);
    if (!["queued", "running"].includes(current.status)) return current;
    const status = reason === "CONTENT_VERSION_CHANGED" ? "failed" : "cancelled";
    this.db
      .prepare(
        "UPDATE selection_qa_turns SET status=?,phase='terminal',error_code=?,lease_generation=lease_generation+1,lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE user_id=? AND id=?",
      )
      .run(status, reason, Date.now(), userId, id);
    this.event(userId, id, "terminal", {
      status,
      reason,
      answer: current.answer,
      answerVersion: current.answerVersion,
      quality: current.quality,
    });
    return this.turn(userId, id);
  }
  delete(userId: number, id: string): void {
    this.db
      .prepare(
        "DELETE FROM selection_qa_conversations WHERE user_id=? AND id=?",
      )
      .run(userId, id);
  }
  conversations(
    userId: number,
    bookId: number,
    cursor: string | undefined,
    limit: number,
  ): Conversation[] {
    let stamp = Number.MAX_SAFE_INTEGER,
      id = "~";
    if (cursor) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.from(cursor, "base64url").toString());
      } catch {
        throw new SelectionQaError("INVALID_CURSOR", 400);
      }
      if (
        !Array.isArray(parsed) ||
        parsed.length !== 2 ||
        !Number.isSafeInteger(parsed[0]) ||
        typeof parsed[1] !== "string"
      )
        throw new SelectionQaError("INVALID_CURSOR", 400);
      [stamp, id] = parsed as [number, string];
    }
    return this.db
      .prepare(
        "SELECT * FROM selection_qa_conversations WHERE user_id=? AND book_id=? AND (created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT ?",
      )
      .all(userId, bookId, stamp, stamp, id, limit)
      .map((row) => this.mapConversation(row));
  }
  turns(userId: number, id: string, after: number, limit: number): Turn[] {
    return this.db
      .prepare(
        "SELECT * FROM selection_qa_turns WHERE user_id=? AND conversation_id=? AND turn_number>? ORDER BY turn_number LIMIT ?",
      )
      .all(userId, id, after, limit)
      .map((row) => this.mapTurn(row));
  }
  findEvidence(
    userId: number,
    turnId: string,
    evidenceId: string,
  ): QaSavedEvidence {
    const row = this.db
      .prepare(
        "SELECT evidence_json FROM selection_qa_evidence WHERE user_id=? AND turn_id=? AND evidence_id=?",
      )
      .get(userId, turnId, evidenceId);
    if (!row) throw new SelectionQaError("EVIDENCE_NOT_FOUND", 404);
    return JSON.parse(String(row.evidence_json)) as QaSavedEvidence;
  }
  events(userId: number, id: string, after: number): SelectionQaEvent[] {
    return this.db
      .prepare(
        "SELECT * FROM selection_qa_events WHERE user_id=? AND turn_id=? AND sequence>? ORDER BY sequence LIMIT 200",
      )
      .all(userId, id, after)
      .map((row) => ({
        schemaVersion: 2,
        turnId: id,
        sequence: Number(row.sequence),
        kind: row.kind as SelectionQaEvent["kind"],
        data: JSON.parse(String(row.payload_json)),
      }));
  }
  private event(
    userId: number,
    id: string,
    kind: string,
    payload: unknown,
  ): void {
    this.db
      .prepare(
        "UPDATE selection_qa_turns SET last_sequence=last_sequence+1 WHERE user_id=? AND id=?",
      )
      .run(userId, id);
    this.eventsChanged(userId, id);
    const turn = this.turn(userId, id);
    this.db
      .prepare("INSERT INTO selection_qa_events VALUES(?,?,?,?,?,?)")
      .run(
        id,
        userId,
        turn.lastSequence,
        kind,
        JSON.stringify(payload),
        Date.now(),
      );
  }
  private mapConversation(r: Record<string, unknown>): Conversation {
    return {
      id: String(r.id),
      userId: Number(r.user_id),
      bookId: Number(r.book_id),
      selection: JSON.parse(String(r.selection_json)),
      status: r.status as Conversation["status"],
      frozenReason: r.frozen_reason === null ? null : String(r.frozen_reason),
      firstQuestion: String(r.first_question),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    };
  }
  private mapTurn(r: Record<string, unknown>): Turn {
    const versionEvent = this.db.prepare("SELECT sequence,payload_json FROM selection_qa_events WHERE user_id=? AND turn_id=? AND kind='status' AND json_extract(payload_json,'$.operation')='answer_version' ORDER BY sequence DESC LIMIT 1").get(Number(r.user_id), String(r.id));
    const version = versionEvent ? Number(JSON.parse(String(versionEvent.payload_json)).answerVersion) : undefined;
    const qualityEvent = this.db.prepare("SELECT payload_json FROM selection_qa_events WHERE user_id=? AND turn_id=? AND kind='status' AND json_extract(payload_json,'$.operation')='quality_check' AND json_extract(payload_json,'$.state')='completed' AND sequence>? ORDER BY sequence DESC LIMIT 1").get(Number(r.user_id), String(r.id), versionEvent ? Number(versionEvent.sequence) : Number(r.last_sequence));
    return {
      ...(version !== undefined ? { answerVersion: version } : {}),
      ...(qualityEvent ? { quality: JSON.parse(String(qualityEvent.payload_json)).judgment } : {}),
      id: String(r.id),
      userId: Number(r.user_id),
      conversationId: String(r.conversation_id),
      turnNumber: Number(r.turn_number),
      question: String(r.question),
      answer: String(r.answer),
      status: r.status as Turn["status"],
      errorCode: r.error_code === null ? null : String(r.error_code),
      retryOfTurnId:
        r.retry_of_turn_id === null ? null : String(r.retry_of_turn_id),
      deadline: Number(r.deadline),
      lastSequence: Number(r.last_sequence),
      phase: String(r.phase),
      process: this.db.prepare("SELECT sequence,created_at,payload_json FROM selection_qa_events WHERE user_id=? AND turn_id=? AND kind='status' AND sequence<=? ORDER BY sequence")
        .all(Number(r.user_id), String(r.id), Number(r.last_sequence)).map(event => {
          const detail = JSON.parse(String(event.payload_json));
          // Older process events stored previews, while their full evidence remains in this turn's ledger.
          if (Array.isArray(detail.results) && detail.results.some((item: { truncated?: boolean }) => item.truncated)) {
            const evidence = this.db.prepare("SELECT evidence_json FROM selection_qa_evidence WHERE user_id=? AND turn_id=?")
              .all(Number(r.user_id), String(r.id)).map(row => JSON.parse(String(row.evidence_json)));
            detail.results = detail.results.map((item: { truncated?: boolean; href: string; sectionIndex: number; start: number; end: number; excerpt?: string }) => {
              if (!item.truncated) return item;
              const match = evidence.find(e => e.href === item.href && e.sectionIndex === item.sectionIndex && e.start === item.start && e.end === item.end && e.quote.startsWith(item.excerpt));
              return match ? { sectionIndex: item.sectionIndex, href: item.href, start: item.start, end: item.end, text: match.quote } : item;
            });
          }
          return { sequence: Number(event.sequence), at: Number(event.created_at), phase: String(detail.phase ?? detail.status), detail };
        }),
      citations: this.db
        .prepare(
          "SELECT payload_json FROM selection_qa_events WHERE user_id=? AND turn_id=? AND kind='citation' AND sequence<=? AND sequence>? ORDER BY sequence",
        )
        .all(Number(r.user_id), String(r.id), Number(r.last_sequence), versionEvent ? Number(versionEvent.sequence) : 0)
        .map((event) => JSON.parse(String(event.payload_json)).evidence),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    };
  }
}
