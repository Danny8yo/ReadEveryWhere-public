import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { SqliteService } from "../../../platform/persistence/sqlite/sqlite.service";
import { assertPublicReadingEventPayloadV2 } from '../application/public-reading-event';
import {
  ReadingEvent,
  type ConversationCheckpoint,
  type ReadingEventJSON,
  type ReadingTask,
} from '../domain';
import type {
  AgentRunLease,
  AgentRunRecordV2,
  AgentRunStorePort,
  AgentRunWriteAuthority,
  AgentStepRecord,
} from "../application/ports/agent-run-store.port";

interface RunRow {
  id: string; task_id: string; parent_run_id: string | null; depth: number; goal: string;
  deliverable: string | null; goal_fingerprint: string | null; status: AgentRunRecordV2["status"];
  checkpoint_json: string | null; cancel_requested: number; node_limits_json: string | null;
  terminal_reason: string | null; created_at: string; updated_at: string | null;
  started_at: string | null; finished_at: string | null; lease_owner: string | null;
  lease_token: string | null; lease_generation: number; lease_expires_at: string | null;
  execution_ms?: number; result_json?: string | null;
  used_model_turns: number; used_tool_calls: number; used_read_characters: number;
  used_delegated_agents: number; prompt_tokens: number; completion_tokens: number; total_tokens: number;
  cache_read_input_tokens: number | null; cache_write_input_tokens: number | null;
  uncached_input_tokens: number | null;
}

interface StepRow {
  id: string; task_id: string; agent_run_id: string; step_no: number; model_call_id: string | null;
  tool_call_id: string | null; kind: AgentStepRecord["kind"]; status: AgentStepRecord["status"];
  request_fingerprint: string; result_json: string | null; created_at: string; finished_at: string | null;
}

@Injectable()
export class AgentRunRepository implements AgentRunStorePort {
  constructor(private readonly sqliteService: SqliteService) {}

  create(run: AgentRunRecordV2): void {
    const db = this.sqliteService.getDatabase();
    db.prepare(`
      INSERT INTO ai_reading_agent_runs (
        id, task_id, parent_run_id, depth, goal, status, state_json, created_at, started_at, finished_at,
        schema_version, deliverable, goal_fingerprint, checkpoint_json, checkpoint_version,
        cancel_requested, node_limits_json, terminal_reason, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2, ?, ?, ?, 1, ?, ?, ?, ?)
    `).run(
      run.id, run.taskId, run.parentRunId ?? null, run.depth, run.goal, run.status, JSON.stringify(run),
      run.createdAt, run.startedAt ?? null, run.finishedAt ?? null, run.deliverable, run.goalFingerprint,
      JSON.stringify(run.checkpoint), run.cancelRequested ? 1 : 0, JSON.stringify(run.nodeLimits),
      run.terminalReason ?? null, run.updatedAt,
    );
  }

  createDelegatedChildren(input: {
    parent: AgentRunRecordV2;
    children: AgentRunRecordV2[];
    step: AgentStepRecord;
    authority: AgentRunWriteAuthority;
    budgetReservationId?: string;
    events?: Array<Omit<ReadingEventJSON, 'sequence'>>;
  }): "created" | "existing" | "fenced" {
    const db = this.sqliteService.getDatabase();
    return transaction(db, () => {
      if (!canWrite(db, input.parent.id, input.authority)) return "fenced";
      const existing = db.prepare(
        "SELECT * FROM ai_reading_agent_steps WHERE agent_run_id = ? AND step_no = ?",
      ).get(input.parent.id, input.step.stepNo) as unknown as StepRow | undefined;
      if (existing) {
        if (existing.kind !== "delegate" || existing.request_fingerprint !== input.step.requestFingerprint) {
          throw new Error("AGENT_STEP_CONFLICT");
        }
        return "existing";
      }
      if (input.children.length < 1 || input.children.length > 3
        || input.children.some((child) => child.taskId !== input.parent.taskId
          || child.parentRunId !== input.parent.id || child.depth !== input.parent.depth + 1)) {
        throw new Error("DELEGATION_BATCH_INVALID");
      }
      const parentChildren = db.prepare(`SELECT COUNT(1) AS count FROM ai_reading_agent_runs
        WHERE task_id = ? AND parent_run_id = ? AND schema_version = 2`)
        .get(input.parent.taskId, input.parent.id) as unknown as { count: number };
      if (Number(parentChildren.count) + input.children.length > 3) {
        throw new Error("DELEGATION_PARENT_EXCEEDED");
      }
      const layerRuns = db.prepare(`SELECT COUNT(1) AS count FROM ai_reading_agent_runs
        WHERE task_id = ? AND depth = ? AND schema_version = 2`)
        .get(input.parent.taskId, input.parent.depth + 1) as unknown as { count: number };
      if (Number(layerRuns.count) + input.children.length > 3) {
        throw new Error("DELEGATION_LAYER_EXCEEDED");
      }
      const fingerprints = input.children.map((child) => child.goalFingerprint);
      if (fingerprints.some((value) => !value) || new Set(fingerprints).size !== fingerprints.length) {
        throw new Error("DELEGATION_GOAL_DUPLICATE");
      }
      const fingerprintPlaceholders = fingerprints.map(() => '?').join(',');
      const duplicateGoal = db.prepare(`SELECT 1 AS found FROM ai_reading_agent_runs
        WHERE task_id = ? AND schema_version = 2 AND goal_fingerprint IN (${fingerprintPlaceholders}) LIMIT 1`)
        .get(input.parent.taskId, ...fingerprints) as unknown as { found: number } | undefined;
      if (duplicateGoal) throw new Error("DELEGATION_GOAL_DUPLICATE");
      db.prepare(`INSERT INTO ai_reading_agent_steps (id,task_id,agent_run_id,step_no,model_call_id,tool_call_id,
        kind,status,request_fingerprint,result_json,created_at,finished_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(input.step.id, input.step.taskId, input.step.agentRunId, input.step.stepNo,
          input.step.modelCallId ?? null, input.step.toolCallId ?? null, "delegate", "completed",
          input.step.requestFingerprint, JSON.stringify({ childRunIds: input.children.map((child) => child.id) }),
          input.step.createdAt, input.step.finishedAt ?? input.authority.now);
      const insert = db.prepare(`INSERT INTO ai_reading_agent_runs (
        id,task_id,parent_run_id,depth,goal,status,state_json,created_at,started_at,finished_at,
        schema_version,deliverable,goal_fingerprint,checkpoint_json,checkpoint_version,cancel_requested,
        node_limits_json,terminal_reason,updated_at,execution_ms,result_json
      ) VALUES (?,?,?,?,?,?,?,?,?,?,2,?,?,?,?,?,?,?,?,?,?)`);
      for (const child of input.children) {
        insert.run(child.id, child.taskId, child.parentRunId ?? null, child.depth, child.goal, child.status,
          JSON.stringify(child), child.createdAt, child.startedAt ?? null, child.finishedAt ?? null,
          child.deliverable, child.goalFingerprint, JSON.stringify(child.checkpoint), 1,
          child.cancelRequested ? 1 : 0, JSON.stringify(child.nodeLimits), child.terminalReason ?? null,
          child.updatedAt, child.executionMs ?? 0, child.result === undefined ? null : JSON.stringify(child.result));
      }
      if (input.budgetReservationId) {
        const reservation = db.prepare(`SELECT * FROM ai_reading_budget_reservations
          WHERE id = ? AND task_id = ? AND agent_run_id = ? AND status = 'reserved'`)
          .get(input.budgetReservationId, input.parent.taskId, input.parent.id) as unknown as Record<string, unknown> | undefined;
        if (!reservation) throw new Error('DELEGATION_BUDGET_RESERVATION_NOT_FOUND');
        const reservedModelTurns = Number(reservation.reserved_model_turns ?? 0);
        const reservedToolCalls = Number(reservation.reserved_tool_calls ?? 0);
        const reservedReadCharacters = Number(reservation.reserved_read_characters ?? 0);
        const reservedDelegatedAgents = Number(reservation.reserved_delegated_agents ?? 0);
        if (reservedModelTurns !== 0 || reservedToolCalls !== 1 || reservedReadCharacters !== 0
          || reservedDelegatedAgents !== input.children.length) {
          throw new Error('DELEGATION_BUDGET_RESERVATION_INVALID');
        }
        db.prepare(`UPDATE ai_reading_budget_reservations SET status='settled',actual_model_turns=0,
          actual_tool_calls=1,actual_read_characters=0,actual_delegated_agents=?,settled_at=? WHERE id=?`)
          .run(input.children.length, input.authority.now, input.budgetReservationId);
        for (const [table, column, id] of [
          ['ai_reading_task_budgets', 'task_id', input.parent.taskId],
          ['ai_reading_agent_runs', 'id', input.parent.id],
        ] as const) {
          db.prepare(`UPDATE ${table} SET reserved_tool_calls=reserved_tool_calls-1,
            reserved_delegated_agents=reserved_delegated_agents-?,used_tool_calls=used_tool_calls+1,
            used_delegated_agents=used_delegated_agents+? WHERE ${column}=?`)
            .run(input.children.length, input.children.length, id);
        }
      }
      for (const event of input.events ?? []) insertEvent(db, event);
      const lease = input.authority.lease;
      const updated = db.prepare(`UPDATE ai_reading_agent_runs SET status='waiting_children',state_json=?,
        checkpoint_json=?,checkpoint_version=checkpoint_version+1,updated_at=?,lease_owner=NULL,lease_token=NULL,
        lease_expires_at=NULL WHERE id=? AND lease_owner=? AND lease_token=? AND lease_generation=?
        AND lease_expires_at>? AND cancel_requested=0`)
        .run(JSON.stringify(input.parent), JSON.stringify(input.parent.checkpoint), input.parent.updatedAt,
          input.parent.id, lease.workerId, lease.leaseToken, lease.generation, input.authority.now);
      if (updated.changes !== 1) throw new Error("AGENT_RUN_FENCED");
      return "created";
    });
  }

  commitTerminal(input: {
    task?: ReadingTask;
    run: AgentRunRecordV2;
    checkpoint?: ConversationCheckpoint;
    events?: Array<Omit<ReadingEventJSON, 'sequence'>>;
    authority: AgentRunWriteAuthority;
  }): 'committed' | 'fenced' {
    const db = this.sqliteService.getDatabase();
    return transaction(db, () => {
      if (!canWrite(db, input.run.id, input.authority)) return 'fenced';
      if (!['completed', 'partial', 'failed', 'cancelled'].includes(input.run.status)) {
        throw new Error('AGENT_RUN_TERMINAL_STATE_INVALID');
      }
      if (input.authority.lease.agentRunId !== input.run.id) {
        throw new Error('AGENT_RUN_TERMINAL_AUTHORITY_INVALID');
      }
      for (const event of input.events ?? []) {
        if (event.taskId !== input.run.taskId || event.agentRunId !== input.run.id) {
          throw new Error('AGENT_RUN_TERMINAL_EVENT_INVALID');
        }
        assertPublicReadingEventPayloadV2(event.payload);
      }

      if (input.task) {
        const value = input.task.toJSON();
        if (value.id !== input.run.taskId
          || !['completed', 'partial', 'needs_input', 'failed', 'cancelled'].includes(value.status)) {
          throw new Error('READING_TASK_TERMINAL_STATE_INVALID');
        }
        if (['completed', 'partial', 'needs_input'].includes(value.status) !== Boolean(input.checkpoint)) {
          throw new Error('CONVERSATION_CHECKPOINT_REQUIRED');
        }
        const taskUpdated = db.prepare(`UPDATE ai_reading_tasks SET status=?,state_json=?,updated_at=?,finished_at=?
          WHERE id=? AND user_id=? AND schema_version=2 AND cancel_requested=0
            AND status IN ('queued','running')`)
          .run(value.status, JSON.stringify(value), value.updatedAt, value.finishedAt ?? null,
            value.id, Number(value.userId));
        if (taskUpdated.changes !== 1) throw new Error('AGENT_RUN_FENCED');
      } else if (input.checkpoint) {
        throw new Error('CONVERSATION_CHECKPOINT_WITHOUT_TASK');
      }

      if (input.checkpoint) {
        const value = input.checkpoint.toJSON();
        const owner = db.prepare(`SELECT 1 AS owned FROM reading_conversation_turns t
          INNER JOIN reading_conversations c ON c.id=t.conversation_id
          INNER JOIN ai_reading_tasks task ON task.id=t.task_id
          WHERE t.id=? AND t.conversation_id=? AND t.task_id=? AND task.user_id=c.user_id`)
          .get(value.throughTurnId, value.conversationId, input.run.taskId) as unknown as { owned: number } | undefined;
        if (!owner) throw new Error('CONVERSATION_CHECKPOINT_SCOPE_INVALID');
        db.prepare(`INSERT INTO reading_conversation_checkpoints
          (id,conversation_id,through_turn_id,schema_version,memory_json,source_refs_json,character_count,created_at)
          VALUES (?,?,?,?,?,?,?,?)`)
          .run(value.id, value.conversationId, value.throughTurnId, value.schemaVersion,
            JSON.stringify(value.memory), JSON.stringify(value.sourceRefs), value.characterCount, value.createdAt);
      }

      for (const event of input.events ?? []) insertEvent(db, event);
      const lease = input.authority.lease;
      const result = db.prepare(`UPDATE ai_reading_agent_runs SET status=?,state_json=?,checkpoint_json=?,
        checkpoint_version=checkpoint_version+1,cancel_requested=?,terminal_reason=?,updated_at=?,started_at=?,
        finished_at=?,execution_ms=?,result_json=?,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL
        WHERE id=? AND task_id=? AND schema_version=2 AND lease_owner=? AND lease_token=? AND lease_generation=?
          AND lease_expires_at>? AND cancel_requested=0`)
        .run(input.run.status, JSON.stringify(input.run), JSON.stringify(input.run.checkpoint),
          input.run.cancelRequested ? 1 : 0, input.run.terminalReason ?? null, input.run.updatedAt,
          input.run.startedAt ?? null, input.run.finishedAt ?? null, input.run.executionMs ?? 0,
          input.run.result === undefined ? null : JSON.stringify(input.run.result), input.run.id,
          input.run.taskId, lease.workerId, lease.leaseToken, lease.generation, input.authority.now);
      if (result.changes !== 1) throw new Error('AGENT_RUN_FENCED');
      return 'committed';
    });
  }

  find(runId: string): AgentRunRecordV2 | null {
    const row = this.sqliteService.getDatabase().prepare(`${RUN_SELECT} WHERE id = ? AND schema_version = 2`)
      .get(runId) as unknown as RunRow | undefined;
    return row ? toRun(row) : null;
  }

  listForTask(taskId: string): AgentRunRecordV2[] {
    const rows = this.sqliteService.getDatabase().prepare(
      `${RUN_SELECT} WHERE task_id = ? AND schema_version = 2 ORDER BY depth, created_at, id`,
    ).all(taskId) as unknown as RunRow[];
    return rows.map(toRun);
  }

  claimNext(
    workerId: string,
    now: string,
    maxRunning = 4,
    excludedRunIds: readonly string[] = [],
  ): { run: AgentRunRecordV2; lease: AgentRunLease } | null {
    const db = this.sqliteService.getDatabase();
    return transaction(db, () => {
      const running = db.prepare(`SELECT COUNT(1) AS count FROM ai_reading_agent_runs
        WHERE schema_version = 2 AND status = 'running' AND cancel_requested = 0
          AND lease_expires_at > ?`).get(now) as unknown as { count: number };
      if (Number(running.count) >= maxRunning) return null;
      const exclusions = uniqueNonEmpty(excludedRunIds);
      const exclusionClause = exclusions.length > 0
        ? `AND id NOT IN (${exclusions.map(() => '?').join(',')})`
        : '';
      const row = db.prepare(`${RUN_SELECT}
        WHERE schema_version = 2 AND status IN ('queued','running') AND cancel_requested = 0
          AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
          ${exclusionClause}
          AND (depth = 0 OR (SELECT COUNT(1) FROM ai_reading_agent_runs active
            WHERE active.task_id = ai_reading_agent_runs.task_id AND active.schema_version = 2
              AND active.depth > 0 AND active.status = 'running' AND active.cancel_requested = 0
              AND active.lease_expires_at > ?)
            < COALESCE((SELECT json_extract(policy_json,'$.concurrentAgents')
              FROM ai_reading_task_budgets WHERE task_id = ai_reading_agent_runs.task_id), ?))
        ORDER BY created_at, id LIMIT 1`).get(now, ...exclusions, now, maxRunning) as unknown as RunRow | undefined;
      if (!row) return null;
      const lease: AgentRunLease = {
        agentRunId: row.id,
        workerId,
        leaseToken: randomUUID(),
        generation: Number(row.lease_generation) + 1,
        expiresAt: new Date(Date.parse(now) + 60_000).toISOString(),
      };
      const updated = db.prepare(`UPDATE ai_reading_agent_runs SET status = 'running', started_at = COALESCE(started_at, ?),
        updated_at = ?, lease_owner = ?, lease_token = ?, lease_generation = ?, lease_expires_at = ?
        WHERE id = ? AND lease_generation = ? AND status IN ('queued','running') AND cancel_requested = 0
          AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`)
        .run(now, now, workerId, lease.leaseToken, lease.generation, lease.expiresAt, row.id, row.lease_generation, now);
      if (updated.changes !== 1) return null;
      return { run: { ...toRun(row), status: "running", startedAt: row.started_at ?? now, updatedAt: now }, lease };
    });
  }

  renewLease(lease: AgentRunLease, now: string): AgentRunLease | null {
    const expiresAt = new Date(Date.parse(now) + 60_000).toISOString();
    const result = this.sqliteService.getDatabase().prepare(`UPDATE ai_reading_agent_runs SET lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND lease_owner = ? AND lease_token = ? AND lease_generation = ?
        AND lease_expires_at > ? AND status = 'running' AND cancel_requested = 0`)
      .run(expiresAt, now, lease.agentRunId, lease.workerId, lease.leaseToken, lease.generation, now);
    return result.changes === 1 ? { ...lease, expiresAt } : null;
  }

  save(run: AgentRunRecordV2, authority: AgentRunWriteAuthority): boolean {
    const db = this.sqliteService.getDatabase();
    return transaction(db, () => {
      if (!canWrite(db, run.id, authority)) return false;
      const terminal = ["completed", "partial", "failed", "cancelled"].includes(run.status);
      const lease = authority.lease;
      const result = db.prepare(`UPDATE ai_reading_agent_runs SET status = ?, state_json = ?, checkpoint_json = ?,
        checkpoint_version = checkpoint_version + 1, cancel_requested = ?, terminal_reason = ?, updated_at = ?,
        started_at = ?, finished_at = ?, execution_ms = ?, result_json = ?,
        lease_owner = CASE WHEN ? THEN NULL ELSE lease_owner END,
        lease_token = CASE WHEN ? THEN NULL ELSE lease_token END, lease_expires_at = CASE WHEN ? THEN NULL ELSE lease_expires_at END
        WHERE id = ? AND schema_version = 2 AND lease_owner = ? AND lease_token = ? AND lease_generation = ?
          AND lease_expires_at > ? AND cancel_requested = 0`)
        .run(run.status, JSON.stringify(run), JSON.stringify(run.checkpoint), run.cancelRequested ? 1 : 0,
          run.terminalReason ?? null, run.updatedAt, run.startedAt ?? null, run.finishedAt ?? null,
          run.executionMs ?? 0, run.result === undefined ? null : JSON.stringify(run.result),
          run.status !== "running" ? 1 : 0,
          run.status !== "running" ? 1 : 0,
          run.status !== "running" ? 1 : 0,
          run.id, lease.workerId, lease.leaseToken, lease.generation, authority.now);
      return result.changes === 1;
    });
  }

  startStep(step: AgentStepRecord, authority: AgentRunWriteAuthority): AgentStepRecord | null {
    const db = this.sqliteService.getDatabase();
    return transaction(db, () => {
      if (!canWrite(db, step.agentRunId, authority)) return null;
      const existing = db.prepare("SELECT * FROM ai_reading_agent_steps WHERE agent_run_id = ? AND step_no = ?")
        .get(step.agentRunId, step.stepNo) as unknown as StepRow | undefined;
      if (existing) {
        if (existing.kind !== step.kind || existing.request_fingerprint !== step.requestFingerprint) {
          throw new Error("AGENT_STEP_CONFLICT");
        }
        return toStep(existing);
      }
      db.prepare(`INSERT INTO ai_reading_agent_steps (id,task_id,agent_run_id,step_no,model_call_id,tool_call_id,
        kind,status,request_fingerprint,result_json,created_at,finished_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(step.id, step.taskId, step.agentRunId, step.stepNo, step.modelCallId ?? null, step.toolCallId ?? null,
          step.kind, step.status, step.requestFingerprint, step.result === undefined ? null : JSON.stringify(step.result),
          step.createdAt, step.finishedAt ?? null);
      return step;
    });
  }

  completeStep(stepId: string, result: unknown, finishedAt: string, authority: AgentRunWriteAuthority): boolean {
    const db = this.sqliteService.getDatabase();
    return transaction(db, () => {
      if (!canWrite(db, authority.lease.agentRunId, authority)) return false;
      const changed = db.prepare(`UPDATE ai_reading_agent_steps SET status = 'completed', result_json = ?, finished_at = ?
        WHERE id = ? AND agent_run_id = ? AND status = 'started'`)
        .run(JSON.stringify(result), finishedAt, stepId, authority.lease.agentRunId);
      if (changed.changes === 1) return true;
      const existing = db.prepare("SELECT status FROM ai_reading_agent_steps WHERE id = ? AND agent_run_id = ?")
        .get(stepId, authority.lease.agentRunId) as unknown as { status: string } | undefined;
      return existing?.status === "completed";
    });
  }

  findStep(agentRunId: string, stepNo: number): AgentStepRecord | null {
    const row = this.sqliteService.getDatabase().prepare(
      "SELECT * FROM ai_reading_agent_steps WHERE agent_run_id = ? AND step_no = ?",
    ).get(agentRunId, stepNo) as unknown as StepRow | undefined;
    return row ? toStep(row) : null;
  }

  cancelTaskRuns(taskId: string, now: string): number {
    const db = this.sqliteService.getDatabase();
    return transaction(db, () => {
      const result = db.prepare(`UPDATE ai_reading_agent_runs
        SET cancel_requested = 1, status = 'cancelled', terminal_reason = 'USER_CANCELLED', finished_at = ?, updated_at = ?,
          lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
          reserved_model_turns=0,reserved_tool_calls=0,reserved_read_characters=0,reserved_delegated_agents=0
        WHERE task_id = ? AND schema_version = 2 AND status NOT IN ('completed','partial','failed','cancelled')`)
        .run(now, now, taskId);
      db.prepare(`UPDATE ai_reading_budget_reservations SET status='released',settled_at=?
        WHERE task_id=? AND status='reserved'`).run(now, taskId);
      db.prepare(`UPDATE ai_reading_task_budgets SET reserved_model_turns=0,reserved_tool_calls=0,
        reserved_read_characters=0,reserved_delegated_agents=0 WHERE task_id=?`).run(taskId);
      return Number(result.changes);
    });
  }

  resumeReadyParents(now: string): number {
    const result = this.sqliteService.getDatabase().prepare(`UPDATE ai_reading_agent_runs AS parent
      SET status='queued',updated_at=?,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL
      WHERE parent.schema_version=2 AND parent.status='waiting_children' AND parent.cancel_requested=0
        AND EXISTS (SELECT 1 FROM ai_reading_agent_runs child WHERE child.parent_run_id=parent.id)
        AND NOT EXISTS (SELECT 1 FROM ai_reading_agent_runs child WHERE child.parent_run_id=parent.id
          AND child.status NOT IN ('completed','partial','failed','cancelled'))`)
      .run(now);
    return Number(result.changes);
  }
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

const RUN_SELECT = `SELECT id,task_id,parent_run_id,depth,goal,deliverable,goal_fingerprint,status,checkpoint_json,
  cancel_requested,node_limits_json,terminal_reason,created_at,updated_at,started_at,finished_at,lease_owner,
  lease_token,lease_generation,lease_expires_at,execution_ms,result_json,used_model_turns,used_tool_calls,
  used_read_characters,used_delegated_agents,prompt_tokens,completion_tokens,total_tokens,
  cache_read_input_tokens,cache_write_input_tokens,uncached_input_tokens FROM ai_reading_agent_runs`;

function canWrite(db: DatabaseSync, runId: string, authority: AgentRunWriteAuthority): boolean {
  const lease = authority.lease;
  const row = db.prepare(`SELECT 1 AS allowed FROM ai_reading_agent_runs WHERE id = ? AND lease_owner = ?
    AND lease_token = ? AND lease_generation = ? AND lease_expires_at > ? AND cancel_requested = 0`)
    .get(runId, lease.workerId, lease.leaseToken, lease.generation, authority.now) as unknown as { allowed: number } | undefined;
  return Boolean(row);
}

function toRun(row: RunRow): AgentRunRecordV2 {
  return {
    id: row.id, taskId: row.task_id, parentRunId: row.parent_run_id ?? undefined, depth: Number(row.depth),
    goal: row.goal, deliverable: row.deliverable ?? "", goalFingerprint: row.goal_fingerprint ?? "",
    status: row.status, checkpoint: JSON.parse(row.checkpoint_json ?? "{}"),
    nodeLimits: JSON.parse(row.node_limits_json ?? "{}"), cancelRequested: Boolean(row.cancel_requested),
    terminalReason: row.terminal_reason ?? undefined, createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at, startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined, executionMs: Number(row.execution_ms ?? 0),
    result: row.result_json ? JSON.parse(row.result_json) : undefined,
    usage: {
      modelTurns: Number(row.used_model_turns ?? 0), toolCalls: Number(row.used_tool_calls ?? 0),
      readCharacters: Number(row.used_read_characters ?? 0), delegatedAgents: Number(row.used_delegated_agents ?? 0),
      promptTokens: Number(row.prompt_tokens ?? 0), completionTokens: Number(row.completion_tokens ?? 0),
      totalTokens: Number(row.total_tokens ?? 0),
      cacheReadInputTokens: nullableNumber(row.cache_read_input_tokens),
      cacheWriteInputTokens: nullableNumber(row.cache_write_input_tokens),
      uncachedInputTokens: nullableNumber(row.uncached_input_tokens),
    },
  };
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function toStep(row: StepRow): AgentStepRecord {
  return { id: row.id, taskId: row.task_id, agentRunId: row.agent_run_id, stepNo: Number(row.step_no),
    modelCallId: row.model_call_id ?? undefined, toolCallId: row.tool_call_id ?? undefined, kind: row.kind,
    status: row.status, requestFingerprint: row.request_fingerprint,
    result: row.result_json === null ? undefined : JSON.parse(row.result_json), createdAt: row.created_at,
    finishedAt: row.finished_at ?? undefined };
}

function transaction<T>(db: DatabaseSync, action: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try { const result = action(); db.exec("COMMIT"); return result; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}

function insertEvent(db: DatabaseSync, value: Omit<ReadingEventJSON, 'sequence'>): void {
  assertPublicReadingEventPayloadV2(value.payload);
  const next = db.prepare(`SELECT COALESCE(MAX(sequence),0)+1 AS sequence
    FROM ai_reading_events WHERE task_id=?`).get(value.taskId) as unknown as { sequence: number };
  const event = ReadingEvent.create({ ...value, sequence: Number(next.sequence) }).toJSON();
  db.prepare(`INSERT INTO ai_reading_events (task_id,sequence,type,occurred_at,agent_run_id,parent_run_id,
    step_id,model_call_id,tool_call_id,evidence_id,payload_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(event.taskId, event.sequence, event.type, event.occurredAt, event.agentRunId ?? null,
      event.parentRunId ?? null, event.stepId ?? null, event.modelCallId ?? null,
      event.toolCallId ?? null, event.evidenceId ?? null, JSON.stringify(event.payload));
}
