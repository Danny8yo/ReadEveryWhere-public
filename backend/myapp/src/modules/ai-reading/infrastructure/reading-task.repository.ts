import { Injectable } from "@nestjs/common";
import type { DatabaseSync } from "node:sqlite";
import { SqliteService } from "../../../platform/persistence/sqlite/sqlite.service";
import type { ReadingTaskStorePort, TaskWriteAuthority } from "../application/ports/reading-task-store.port";
import {
  assertPublicReadingEventPayloadV2,
  createTaskEventPayload,
} from "../application/public-reading-event";
import {
  ReadingEvent,
  ReadingTask,
  type EvidenceRecord,
  type ReadingEventJSON,
  type ReadingTaskJSON,
} from "../domain";

interface TaskRow {
  id: string;
  user_id: number;
  book_id: number;
  status: string;
  state_json: string;
  request_id: string | null;
  lease_owner: string | null;
  lease_token: string | null;
  lease_generation: number;
  lease_expires_at: string | null;
}

interface EventRow {
  sequence: number;
  type: ReadingEventJSON["type"];
  occurred_at: string;
  task_id: string;
  agent_run_id: string | null;
  parent_run_id: string | null;
  step_id: string | null;
  model_call_id: string | null;
  tool_call_id: string | null;
  evidence_id: string | null;
  payload_json: string;
}

@Injectable()
export class ReadingTaskRepository implements ReadingTaskStorePort {
  constructor(private readonly sqliteService: SqliteService) {}

  create(task: ReadingTask, requestId?: string): void {
    const value = task.toJSON();
    this.insertTask(this.sqliteService.getDatabase(), value, requestId);
  }

  private insertTask(database: DatabaseSync, value: ReadingTaskJSON, requestId?: string): void {
    database.prepare(`
      INSERT INTO ai_reading_tasks (
        id, user_id, book_id, content_revision, goal, budget_tier, status,
        state_json, request_id, cancel_requested, schema_version, created_at, updated_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 2, ?, ?, ?)
    `).run(
      value.id,
      Number(value.userId),
      Number(value.scope.bookId),
      value.scope.contentRevision,
      value.goal,
      value.budgetTier,
      value.status,
      JSON.stringify(value),
      normalizeRequestId(requestId) ?? null,
      value.createdAt,
      value.updatedAt,
      value.finishedAt ?? null,
    );
    this.syncAgentRuns(database, value);
  }

  save(task: ReadingTask, authority: TaskWriteAuthority): boolean {
    const value = task.toJSON();
    const database = this.sqliteService.getDatabase();
    return this.transactionResult(database, () => {
      if (!this.canWrite(database, value.id, authority)) return false;
      const stored = database.prepare('SELECT schema_version,status FROM ai_reading_tasks WHERE id = ?')
        .get(value.id) as unknown as { schema_version: number; status: string } | undefined;
      const result = database.prepare(`
        UPDATE ai_reading_tasks
        SET status = ?, state_json = ?, updated_at = ?, finished_at = ?
        WHERE id = ? AND user_id = ?
          AND (status NOT IN ('completed','partial','needs_input','failed','cancelled') OR status = ?)
      `).run(
        value.status,
        JSON.stringify(value),
        value.updatedAt,
        value.finishedAt ?? null,
        value.id,
        Number(value.userId),
        value.status,
      );
      if (result.changes === 0) return false;
      if (stored?.schema_version === 2 && stored.status === 'queued' && value.status === 'running') {
        const deadlineAt = new Date(
          Date.parse(value.budget.startedAt) + value.budget.policy.maxDurationMs,
        ).toISOString();
        const budget = database.prepare('SELECT policy_json FROM ai_reading_task_budgets WHERE task_id = ?')
          .get(value.id) as unknown as { policy_json: string } | undefined;
        if (!budget) throw new Error('TASK_BUDGET_NOT_FOUND');
        const policy = { ...JSON.parse(budget.policy_json), deadlineAt };
        database.prepare(`UPDATE ai_reading_task_budgets
          SET policy_json=?,deadline_at=?,version=version+1 WHERE task_id=?`)
          .run(JSON.stringify(policy), deadlineAt, value.id);
      }
      if (authority.kind !== "agent_lease") this.syncAgentRuns(database, value);
      return true;
    });
  }

  findForUser(taskId: string, userId: number): ReadingTask | null {
    const row = this.sqliteService.getDatabase().prepare(`
      SELECT id, user_id, book_id, status, state_json, lease_owner, lease_expires_at
      FROM ai_reading_tasks WHERE id = ? AND user_id = ?
    `).get(taskId, userId) as unknown as TaskRow | undefined;
    return row ? ReadingTask.fromJSON(JSON.parse(row.state_json) as ReadingTaskJSON) : null;
  }

  findInternal(taskId: string): ReadingTask | null {
    const row = this.sqliteService.getDatabase().prepare(`
      SELECT id, user_id, book_id, status, state_json, lease_owner, lease_expires_at
      FROM ai_reading_tasks WHERE id = ?
    `).get(taskId) as unknown as TaskRow | undefined;
    return row ? ReadingTask.fromJSON(JSON.parse(row.state_json) as ReadingTaskJSON) : null;
  }

  requestCancellation(taskId: string, userId: number): boolean {
    const result = this.sqliteService.getDatabase().prepare(`
      UPDATE ai_reading_tasks SET cancel_requested = 1
      WHERE id = ? AND user_id = ? AND status IN ('queued','running')
    `).run(taskId, userId);
    return result.changes > 0;
  }

  cancelForUser(taskId: string, userId: number, now: string): ReadingTask | null {
    const database = this.sqliteService.getDatabase();
    database.exec("BEGIN IMMEDIATE");
    try {
      const row = database.prepare(`
        SELECT id, user_id, book_id, status, state_json, lease_owner, lease_expires_at
        FROM ai_reading_tasks WHERE id = ? AND user_id = ?
      `).get(taskId, userId) as unknown as TaskRow | undefined;
      if (!row) {
        database.exec("COMMIT");
        return null;
      }
      const task = ReadingTask.fromJSON(JSON.parse(row.state_json) as ReadingTaskJSON);
      if (task.status !== "queued" && task.status !== "running") {
        database.exec("COMMIT");
        return task;
      }

      task.cancel("user_cancelled", now);
      const value = task.toJSON();
      database.prepare(`
        UPDATE ai_reading_tasks
        SET status = ?, state_json = ?, cancel_requested = 1, updated_at = ?, finished_at = ?,
            lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL
        WHERE id = ? AND user_id = ? AND status IN ('queued','running')
      `).run(value.status, JSON.stringify(value), value.updatedAt, value.finishedAt ?? null, taskId, userId);
      this.syncAgentRuns(database, value);
      database.prepare(`UPDATE ai_reading_agent_runs
        SET cancel_requested = 1, status = 'cancelled', terminal_reason = 'USER_CANCELLED',
            finished_at = ?, updated_at = ?, lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
            reserved_model_turns=0,reserved_tool_calls=0,reserved_read_characters=0,reserved_delegated_agents=0
        WHERE task_id = ? AND schema_version = 2
          AND status NOT IN ('completed','partial','failed','cancelled')`)
        .run(now, now, taskId);
      database.prepare(`UPDATE ai_reading_budget_reservations
        SET status = 'released', settled_at = ? WHERE task_id = ? AND status = 'reserved'`)
        .run(now, taskId);
      database.prepare(`UPDATE ai_reading_task_budgets SET reserved_model_turns=0,reserved_tool_calls=0,
        reserved_read_characters=0,reserved_delegated_agents=0 WHERE task_id=?`).run(taskId);
      const conversationTurn = database.prepare(
        "SELECT 1 AS found FROM reading_conversation_turns WHERE task_id = ?",
      ).get(taskId);
      if (!conversationTurn) {
        database.prepare("DELETE FROM ai_reading_evidence WHERE task_id = ?").run(taskId);
      }
      this.insertEvent(database, {
        type: "task_cancelled",
        occurredAt: now,
        taskId,
        payload: createTaskEventPayload("task_cancelled", { reasonCode: "user_cancelled" }),
      });
      database.exec("COMMIT");
      return task;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  isCancellationRequested(taskId: string): boolean {
    const row = this.sqliteService.getDatabase().prepare(`
      SELECT cancel_requested FROM ai_reading_tasks WHERE id = ?
    `).get(taskId) as unknown as { cancel_requested: number } | undefined;
    return !row || row.cancel_requested === 1;
  }

  appendEvent(
    value: Omit<ReadingEventJSON, "sequence">,
    authority: TaskWriteAuthority,
  ): ReadingEventJSON | null {
    const database = this.sqliteService.getDatabase();
    return this.transactionResult(database, () => (
      this.canWrite(database, value.taskId, authority) ? this.insertEvent(database, value) : null
    ));
  }

  listEvents(taskId: string, userId: number, afterSequence: number, limit: number): {
    items: ReadingEventJSON[];
    nextSequence: number;
    hasMore: boolean;
  } {
    const rows = this.sqliteService.getDatabase().prepare(`
      SELECT e.sequence, e.type, e.occurred_at, e.task_id, e.agent_run_id,
             e.parent_run_id, e.step_id, e.model_call_id, e.tool_call_id,
             e.evidence_id, e.payload_json
      FROM ai_reading_events e
      INNER JOIN ai_reading_tasks t ON t.id = e.task_id
      WHERE e.task_id = ? AND t.user_id = ? AND e.sequence > ?
      ORDER BY e.sequence ASC
      LIMIT ?
    `).all(taskId, userId, afterSequence, limit + 1) as unknown as EventRow[];
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).map((row) => this.mapEvent(row));
    return {
      items: page,
      nextSequence: page[page.length - 1]?.sequence ?? afterSequence,
      hasMore,
    };
  }

  appendMessage(
    taskId: string,
    agentRunId: string,
    role: string,
    content: unknown,
    authority: TaskWriteAuthority,
  ): boolean {
    const database = this.sqliteService.getDatabase();
    return this.transactionResult(database, () => {
      if (!this.canWrite(database, taskId, authority)) return false;
      database.prepare(`
        INSERT INTO ai_reading_messages (task_id, agent_run_id, role, content_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(taskId, agentRunId, role, JSON.stringify(sanitizeRecord(content)), new Date().toISOString());
      return true;
    });
  }

  appendAudit(
    taskId: string,
    agentRunId: string | null,
    kind: string,
    metadata: unknown,
    authority: TaskWriteAuthority,
    ids: { stepId?: string; modelCallId?: string; toolCallId?: string } = {},
  ): boolean {
    const database = this.sqliteService.getDatabase();
    return this.transactionResult(database, () => {
      if (!this.canWrite(database, taskId, authority)) return false;
      database.prepare(`
        INSERT INTO ai_reading_audit (
          task_id, agent_run_id, kind, metadata_json, step_id, model_call_id, tool_call_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        taskId,
        agentRunId,
        kind,
        JSON.stringify(sanitizeRecord(metadata)),
        ids.stepId ?? null,
        ids.modelCallId ?? null,
        ids.toolCallId ?? null,
        new Date().toISOString(),
      );
      return true;
    });
  }

  replaceEvidence(
    taskId: string,
    evidence: EvidenceRecord[],
    authority: TaskWriteAuthority,
  ): boolean {
    const database = this.sqliteService.getDatabase();
    return this.transactionResult(database, () => {
      if (!this.canWrite(database, taskId, authority)) return false;
      database.prepare("DELETE FROM ai_reading_evidence WHERE task_id = ?").run(taskId);
      const insert = database.prepare(`
        INSERT INTO ai_reading_evidence (
          evidence_id, task_id, agent_run_id, quote, citation_json, source_text_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const item of evidence) {
        insert.run(
          item.evidenceId,
          taskId,
          item.agentRunId,
          item.quote.slice(0, 2_000),
          JSON.stringify(item.citation),
          item.sourceTextHash,
          item.createdAt,
        );
      }
      return true;
    });
  }

  listEvidence(taskId: string, userId: number): EvidenceRecord[] {
    const rows = this.sqliteService.getDatabase().prepare(`
      SELECT e.evidence_id, e.task_id, e.agent_run_id, e.quote, e.citation_json,
             e.source_text_hash, e.created_at
      FROM ai_reading_evidence e
      INNER JOIN ai_reading_tasks t ON t.id = e.task_id
      WHERE e.task_id = ? AND t.user_id = ?
      ORDER BY e.created_at ASC
    `).all(taskId, userId) as unknown as Array<{
      evidence_id: string; task_id: string; agent_run_id: string; quote: string;
      citation_json: string; source_text_hash: string; created_at: string;
    }>;
    const task = this.findForUser(taskId, userId);
    if (!task) return [];
    return rows.map((row) => ({
      evidenceId: row.evidence_id,
      taskId: row.task_id,
      agentRunId: row.agent_run_id,
      scope: task.scope.toJSON(),
      quote: row.quote,
      citation: JSON.parse(row.citation_json),
      sourceTool: "book_read",
      sourceTextHash: row.source_text_hash,
      createdAt: row.created_at,
    }));
  }

  private syncAgentRuns(database: DatabaseSync, value: ReadingTaskJSON): void {
    const statement = database.prepare(`
      INSERT INTO ai_reading_agent_runs (
        id, task_id, parent_run_id, depth, goal, status, state_json,
        schema_version, created_at, started_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 2, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        state_json = excluded.state_json,
        started_at = excluded.started_at,
        finished_at = excluded.finished_at
    `);
    for (const run of value.runs) {
      statement.run(
        run.id,
        value.id,
        run.parentRunId ?? null,
        run.depth,
        run.goal,
        run.status,
        JSON.stringify(run),
        run.createdAt,
        run.startedAt ?? null,
        run.finishedAt ?? null,
      );
    }
  }

  private insertEvent(
    database: DatabaseSync,
    value: Omit<ReadingEventJSON, "sequence">,
  ): ReadingEventJSON {
    assertPublicReadingEventPayloadV2(value.payload);
    const row = database.prepare(`
      SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence
      FROM ai_reading_events WHERE task_id = ?
    `).get(value.taskId) as unknown as { sequence: number };
    const event = ReadingEvent.create({ ...value, sequence: Number(row.sequence) }).toJSON();
    database.prepare(`
      INSERT INTO ai_reading_events (
        task_id, sequence, type, occurred_at, agent_run_id, parent_run_id,
        step_id, model_call_id, tool_call_id, evidence_id, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.taskId,
      event.sequence,
      event.type,
      event.occurredAt,
      event.agentRunId ?? null,
      event.parentRunId ?? null,
      event.stepId ?? null,
      event.modelCallId ?? null,
      event.toolCallId ?? null,
      event.evidenceId ?? null,
      JSON.stringify(event.payload),
    );
    return event;
  }

  private mapEvent(row: EventRow): ReadingEventJSON {
    return ReadingEvent.fromJSON({
      sequence: row.sequence,
      type: row.type,
      occurredAt: row.occurred_at,
      taskId: row.task_id,
      agentRunId: row.agent_run_id ?? undefined,
      parentRunId: row.parent_run_id ?? undefined,
      stepId: row.step_id ?? undefined,
      modelCallId: row.model_call_id ?? undefined,
      toolCallId: row.tool_call_id ?? undefined,
      evidenceId: row.evidence_id ?? undefined,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    }).toJSON();
  }

  private canWrite(database: DatabaseSync, taskId: string, authority: TaskWriteAuthority): boolean {
    if (authority.kind === "system") {
      return Boolean(database.prepare("SELECT 1 AS found FROM ai_reading_tasks WHERE id = ?")
        .get(taskId));
    }
    if (authority.kind === "agent_lease") {
      const { lease, now } = authority;
      return Boolean(database.prepare(`SELECT 1 AS active FROM ai_reading_agent_runs
        WHERE id = ? AND task_id = ? AND schema_version = 2 AND lease_owner = ? AND lease_token = ?
          AND lease_generation = ? AND lease_expires_at > ? AND cancel_requested = 0`)
        .get(lease.agentRunId, taskId, lease.workerId, lease.leaseToken, lease.generation, now));
    }
    return false;
  }

  private transactionResult<T>(database: DatabaseSync, callback: () => T): T {
    database.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

function sanitizeRecord(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[Truncated]";
  if (typeof value === "string") return value.slice(0, 4_000);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeRecord(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/api.?key|authorization|reasoning_content|system.?prompt|password|secret|token/i.test(key)) {
      output[key] = "[Redacted]";
      continue;
    }
    output[key] = sanitizeRecord(item, depth + 1);
  }
  return output;
}

function normalizeRequestId(value: string | undefined): string | undefined {
  const normalized = value?.trim().slice(0, 200);
  return normalized || undefined;
}
