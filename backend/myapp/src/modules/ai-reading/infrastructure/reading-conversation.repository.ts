import { Injectable } from '@nestjs/common';
import type { DatabaseSync } from 'node:sqlite';
import { SqliteService } from '../../../platform/persistence/sqlite/sqlite.service';
import type {
  ConversationPage,
  ConversationStorePort,
  ConversationTokenUsage,
  ConversationTurnPage,
  CreateConversationTurnResult,
} from '../application/ports/conversation-store.port';
import {
  ConversationCheckpoint,
  ConversationTurn,
  ReadingConversation,
  type ConversationCheckpointJSON,
  type ConversationTurnJSON,
  type ReadingConversationJSON,
  type ReadingTask,
  type ReadingTaskJSON,
} from '../domain';
import { goalFingerprint } from '../domain/recursive-delegation.policy';
import { createTaskEventPayload } from '../application/public-reading-event';

interface ConversationRow {
  id: string; user_id: number; book_id: number; content_revision: string; root_goal: string;
  status: string; profile_snapshot_json: string; created_at: string; updated_at: string;
  frozen_at: string | null; frozen_reason: string | null;
}

interface TurnRow {
  id: string; conversation_id: string; task_id: string; turn_number: number; user_input: string;
  status: string; retry_of_turn_id: string | null; reader_focus_json: string | null;
  clarification_question: string | null; created_at: string; updated_at: string; finished_at: string | null;
}

interface CheckpointRow {
  id: string; conversation_id: string; through_turn_id: string; schema_version: number;
  memory_json: string; source_refs_json: string; character_count: number; created_at: string;
}

@Injectable()
export class ReadingConversationRepository implements ConversationStorePort {
  constructor(private readonly sqliteService: SqliteService) {}

  createWithTurn(input: {
    conversation: ReadingConversation; turn: ConversationTurn; task: ReadingTask;
    requestId?: string; maxActiveTurns: number;
  }): CreateConversationTurnResult {
    return transaction(this.sqliteService.getDatabase(), (db) => {
      if (activeTurnCount(db) >= input.maxActiveTurns) return 'service_turn_limit';
      insertConversation(db, input.conversation.toJSON());
      insertTaskAndBudget(db, input.task.toJSON(), input.requestId);
      insertTurn(db, input.turn.toJSON());
      return 'created';
    });
  }

  addTurn(input: {
    conversation: ReadingConversation; turn: ConversationTurn; task: ReadingTask;
    requestId?: string; maxActiveTurns: number;
  }): CreateConversationTurnResult {
    return transaction(this.sqliteService.getDatabase(), (db) => {
      const active = db.prepare(`SELECT 1 AS active FROM reading_conversation_turns
        WHERE conversation_id = ? AND status IN ('queued','running') LIMIT 1`)
        .get(input.conversation.id) as unknown as { active: number } | undefined;
      if (active) return 'conversation_turn_active';
      if (activeTurnCount(db) >= input.maxActiveTurns) return 'service_turn_limit';
      const owner = db.prepare('SELECT user_id FROM reading_conversations WHERE id = ?')
        .get(input.conversation.id) as unknown as { user_id: number } | undefined;
      if (!owner || String(owner.user_id) !== input.conversation.userId) {
        throw new Error('CONVERSATION_NOT_FOUND');
      }
      insertTaskAndBudget(db, input.task.toJSON(), input.requestId);
      insertTurn(db, input.turn.toJSON());
      db.prepare('UPDATE reading_conversations SET updated_at = ? WHERE id = ?')
        .run(input.turn.toJSON().updatedAt, input.conversation.id);
      return 'created';
    });
  }

  findForUser(conversationId: string, userId: number): ReadingConversation | null {
    const row = this.sqliteService.getDatabase().prepare(
      'SELECT * FROM reading_conversations WHERE id = ? AND user_id = ?',
    ).get(conversationId, userId) as unknown as ConversationRow | undefined;
    return row ? toConversation(row) : null;
  }

  listForBook(userId: number, bookId: number, page: number, pageSize: number): ConversationPage {
    const db = this.sqliteService.getDatabase();
    const rows = db.prepare(`SELECT * FROM reading_conversations WHERE user_id = ? AND book_id = ?
      ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`)
      .all(userId, bookId, pageSize, (page - 1) * pageSize) as unknown as ConversationRow[];
    const count = db.prepare('SELECT COUNT(1) AS total FROM reading_conversations WHERE user_id = ? AND book_id = ?')
      .get(userId, bookId) as unknown as { total: number };
    return { items: rows.map(toConversation), total: Number(count.total), page, pageSize };
  }

  findTurnForUser(conversationId: string, turnId: string, userId: number): ConversationTurn | null {
    const row = this.sqliteService.getDatabase().prepare(`${TURN_SELECT}
      INNER JOIN reading_conversations c ON c.id = t.conversation_id
      WHERE t.conversation_id = ? AND t.id = ? AND c.user_id = ?`)
      .get(conversationId, turnId, userId) as unknown as TurnRow | undefined;
    return row ? toTurn(row) : null;
  }

  findTurnByTaskId(taskId: string): ConversationTurn | null {
    const row = this.sqliteService.getDatabase().prepare(`${TURN_SELECT} WHERE t.task_id = ?`)
      .get(taskId) as unknown as TurnRow | undefined;
    return row ? toTurn(row) : null;
  }

  listTurns(
    conversationId: string, userId: number, beforeTurnNumber: number | null, pageSize: number,
  ): ConversationTurnPage {
    const rows = this.sqliteService.getDatabase().prepare(`${TURN_SELECT}
      INNER JOIN reading_conversations c ON c.id = t.conversation_id
      WHERE t.conversation_id = ? AND c.user_id = ? AND (? IS NULL OR t.turn_number < ?)
      ORDER BY t.turn_number DESC LIMIT ?`)
      .all(conversationId, userId, beforeTurnNumber, beforeTurnNumber, pageSize + 1) as unknown as TurnRow[];
    const hasMore = rows.length > pageSize;
    const page = rows.slice(0, pageSize).map(toTurn);
    return {
      items: page.reverse(), hasMore,
      nextBeforeTurnNumber: hasMore ? Number(rows[pageSize - 1].turn_number) : null,
    };
  }

  latestCheckpoint(conversationId: string, userId: number): ConversationCheckpoint | null {
    const row = this.sqliteService.getDatabase().prepare(`SELECT cp.* FROM reading_conversation_checkpoints cp
      INNER JOIN reading_conversations c ON c.id = cp.conversation_id
      INNER JOIN reading_conversation_turns t ON t.id = cp.through_turn_id
      WHERE cp.conversation_id = ? AND c.user_id = ? ORDER BY t.turn_number DESC LIMIT 1`)
      .get(conversationId, userId) as unknown as CheckpointRow | undefined;
    return row ? toCheckpoint(row) : null;
  }

  usageForConversation(conversationId: string, userId: number): ConversationTokenUsage {
    const row = this.sqliteService.getDatabase().prepare(`SELECT
        COALESCE(SUM(b.prompt_tokens), 0) AS prompt_tokens,
        COALESCE(SUM(b.completion_tokens), 0) AS completion_tokens,
        COALESCE(SUM(b.total_tokens), 0) AS total_tokens
      FROM reading_conversations c
      LEFT JOIN reading_conversation_turns t ON t.conversation_id = c.id
      LEFT JOIN ai_reading_task_budgets b ON b.task_id = t.task_id
      WHERE c.id = ? AND c.user_id = ?`)
      .get(conversationId, userId) as unknown as {
        prompt_tokens: number; completion_tokens: number; total_tokens: number;
      };
    return {
      promptTokens: Number(row.prompt_tokens),
      completionTokens: Number(row.completion_tokens),
      totalTokens: Number(row.total_tokens),
    };
  }

  appendCheckpoint(checkpoint: ConversationCheckpoint): boolean {
    const value = checkpoint.toJSON();
    try {
      const result = this.sqliteService.getDatabase().prepare(`INSERT OR IGNORE INTO reading_conversation_checkpoints
        (id,conversation_id,through_turn_id,schema_version,memory_json,source_refs_json,character_count,created_at)
        VALUES (?,?,?,?,?,?,?,?)`)
        .run(value.id, value.conversationId, value.throughTurnId, value.schemaVersion,
          JSON.stringify(value.memory), JSON.stringify(value.sourceRefs), value.characterCount, value.createdAt);
      return result.changes === 1;
    } catch (error) {
      if (isConstraint(error)) return false;
      throw error;
    }
  }

  saveConversation(conversation: ReadingConversation): void {
    const value = conversation.toJSON();
    const result = this.sqliteService.getDatabase().prepare(`UPDATE reading_conversations
      SET status=?,updated_at=?,frozen_at=?,frozen_reason=? WHERE id=? AND user_id=?`)
      .run(value.status, value.updatedAt, value.frozenAt ?? null, value.frozenReason ?? null,
        value.id, Number(value.userId));
    if (result.changes !== 1) throw new Error('CONVERSATION_NOT_FOUND');
  }

  syncTurnFromTask(task: ReadingTask): void {
    const value = task.toJSON();
    const result = this.sqliteService.getDatabase().prepare(`UPDATE reading_conversation_turns SET
      status=?, clarification_question=?, updated_at=?, finished_at=? WHERE task_id=?`)
      .run(value.status, value.clarificationQuestion ?? null, value.updatedAt, value.finishedAt ?? null, value.id);
    if (result.changes === 0 && this.isConversationTask(value.id)) throw new Error('CONVERSATION_TURN_NOT_FOUND');
  }

  isConversationTask(taskId: string): boolean {
    return Boolean(this.sqliteService.getDatabase().prepare(
      'SELECT 1 AS found FROM reading_conversation_turns WHERE task_id = ?',
    ).get(taskId));
  }

  deleteForUser(conversationId: string, userId: number): 'deleted' | 'not_found' | 'active' {
    return transaction(this.sqliteService.getDatabase(), (db) => {
      const found = db.prepare('SELECT 1 AS found FROM reading_conversations WHERE id = ? AND user_id = ?')
        .get(conversationId, userId) as unknown as { found: number } | undefined;
      if (!found) return 'not_found';
      const active = db.prepare(`SELECT 1 AS active FROM reading_conversation_turns
        WHERE conversation_id = ? AND status IN ('queued','running') LIMIT 1`).get(conversationId);
      if (active) return 'active';
      const taskRows = db.prepare(`SELECT task_id FROM reading_conversation_turns
        WHERE conversation_id = ? ORDER BY turn_number DESC`)
        .all(conversationId) as unknown as Array<{ task_id: string }>;
      const removeTask = db.prepare('DELETE FROM ai_reading_tasks WHERE id = ?');
      for (const row of taskRows) removeTask.run(row.task_id);
      db.prepare('DELETE FROM reading_conversations WHERE id = ? AND user_id = ?').run(conversationId, userId);
      return 'deleted';
    });
  }
}

const TURN_SELECT = `SELECT t.id,t.conversation_id,t.task_id,t.turn_number,t.user_input,t.status,
  t.retry_of_turn_id,t.reader_focus_json,t.clarification_question,t.created_at,t.updated_at,t.finished_at
  FROM reading_conversation_turns t`;

function insertConversation(db: DatabaseSync, value: ReadingConversationJSON): void {
  db.prepare(`INSERT INTO reading_conversations
    (id,user_id,book_id,content_revision,root_goal,status,profile_snapshot_json,created_at,updated_at,frozen_at,frozen_reason)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(value.id, Number(value.userId), Number(value.bookId), value.contentRevision, value.rootGoal, value.status,
      JSON.stringify(value.profileSnapshot), value.createdAt, value.updatedAt,
      value.frozenAt ?? null, value.frozenReason ?? null);
}

function insertTurn(db: DatabaseSync, value: ConversationTurnJSON): void {
  db.prepare(`INSERT INTO reading_conversation_turns
    (id,conversation_id,task_id,turn_number,user_input,status,retry_of_turn_id,reader_focus_json,
      clarification_question,created_at,updated_at,finished_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(value.id, value.conversationId, value.taskId, value.turnNumber, value.userInput, value.status,
      value.retryOfTurnId ?? null, value.readerFocus ? JSON.stringify(value.readerFocus) : null,
      value.clarificationQuestion ?? null, value.createdAt, value.updatedAt, value.finishedAt ?? null);
}

function insertTaskAndBudget(db: DatabaseSync, value: ReadingTaskJSON, requestId?: string): void {
  db.prepare(`INSERT INTO ai_reading_tasks
    (id,user_id,book_id,content_revision,goal,budget_tier,status,state_json,request_id,cancel_requested,
      schema_version,created_at,updated_at,finished_at) VALUES (?,?,?,?,?,?,?,?,?,0,2,?,?,?)`)
    .run(value.id, Number(value.userId), Number(value.scope.bookId), value.scope.contentRevision,
      value.goal, value.budgetTier, value.status, JSON.stringify(value), requestId?.trim().slice(0, 200) || null,
      value.createdAt, value.updatedAt, value.finishedAt ?? null);
  const policy = value.budget.policy;
  const deadlineAt = new Date(Date.parse(value.createdAt) + policy.maxDurationMs).toISOString();
  db.prepare(`INSERT INTO ai_reading_task_budgets
    (task_id,schema_version,policy_json,deadline_at,version) VALUES (?,2,?,?,1)`)
    .run(value.id, JSON.stringify({
      modelTurns: policy.maxModelTurns,
      toolCalls: policy.maxToolCalls,
      readCharacters: policy.maxReadCharacters,
      delegatedAgents: policy.maxDelegatedAgents,
      concurrentAgents: policy.maxConcurrentAgents,
      deadlineAt,
    }), deadlineAt);
  const rootRunId = `root-${value.id}`;
  const rootLimits = {
    modelTurns: policy.maxModelTurns,
    toolCalls: policy.maxToolCalls,
    readCharacters: policy.maxReadCharacters,
    executionMs: policy.maxDurationMs,
  };
  const rootRun = {
    id: rootRunId, taskId: value.id, depth: 0, goal: value.goal,
    deliverable: '返回结构化结论、证据引用、未决问题和会话记忆更新',
    goalFingerprint: goalFingerprint(value.goal), status: 'queued',
    checkpoint: { schemaVersion: 1, nextStepNo: 1, messages: [], childResultIds: [] },
    nodeLimits: rootLimits, cancelRequested: false,
    createdAt: value.createdAt, updatedAt: value.updatedAt, executionMs: 0,
  };
  db.prepare(`INSERT INTO ai_reading_agent_runs
    (id,task_id,parent_run_id,depth,goal,status,state_json,created_at,schema_version,deliverable,
      goal_fingerprint,checkpoint_json,checkpoint_version,cancel_requested,node_limits_json,updated_at,execution_ms)
    VALUES (?,?,NULL,0,?,?,?,?,2,?,?,?,1,0,?,?,0)`)
    .run(rootRunId, value.id, value.goal, 'queued', JSON.stringify(rootRun), value.createdAt,
      rootRun.deliverable, rootRun.goalFingerprint, JSON.stringify(rootRun.checkpoint),
      JSON.stringify(rootLimits), value.updatedAt);
  db.prepare(`INSERT INTO ai_reading_events
    (task_id,sequence,type,occurred_at,payload_json) VALUES (?,1,'task_queued',?,?)`)
    .run(value.id, value.createdAt, JSON.stringify(createTaskEventPayload('task_queued', {
      goal: value.goal,
      status: 'queued',
      budgetTier: value.budgetTier,
      budgetMode: value.budgetMode,
      budgetPolicy: {
        maxModelTurns: policy.maxModelTurns,
        maxToolCalls: policy.maxToolCalls,
        maxReadCharacters: policy.maxReadCharacters,
        maxDurationMs: policy.maxDurationMs,
        maxDelegatedAgents: policy.maxDelegatedAgents,
        maxConcurrentAgents: policy.maxConcurrentAgents,
      },
    })));
}

function activeTurnCount(db: DatabaseSync): number {
  const row = db.prepare(`SELECT COUNT(1) AS count FROM reading_conversation_turns
    WHERE status IN ('queued','running')`).get() as unknown as { count: number };
  return Number(row.count);
}

function toConversation(row: ConversationRow): ReadingConversation {
  return ReadingConversation.fromJSON({
    id: row.id, userId: String(row.user_id), bookId: String(row.book_id),
    contentRevision: row.content_revision, rootGoal: row.root_goal,
    status: row.status as ReadingConversationJSON['status'],
    profileSnapshot: JSON.parse(row.profile_snapshot_json), createdAt: row.created_at,
    updatedAt: row.updated_at, frozenAt: row.frozen_at ?? undefined,
    frozenReason: row.frozen_reason as ReadingConversationJSON['frozenReason'] | undefined,
  });
}

function toTurn(row: TurnRow): ConversationTurn {
  return ConversationTurn.fromJSON({
    id: row.id, conversationId: row.conversation_id, taskId: row.task_id,
    turnNumber: Number(row.turn_number), userInput: row.user_input,
    status: row.status as ConversationTurnJSON['status'], retryOfTurnId: row.retry_of_turn_id ?? undefined,
    readerFocus: row.reader_focus_json ? JSON.parse(row.reader_focus_json) : undefined,
    clarificationQuestion: row.clarification_question ?? undefined,
    createdAt: row.created_at, updatedAt: row.updated_at, finishedAt: row.finished_at ?? undefined,
  });
}

function toCheckpoint(row: CheckpointRow): ConversationCheckpoint {
  const value: ConversationCheckpointJSON = {
    id: row.id, conversationId: row.conversation_id, throughTurnId: row.through_turn_id,
    schemaVersion: Number(row.schema_version) as 1, memory: JSON.parse(row.memory_json),
    sourceRefs: JSON.parse(row.source_refs_json), characterCount: Number(row.character_count),
    createdAt: row.created_at,
  };
  return ConversationCheckpoint.fromJSON(value);
}

function transaction<T>(db: DatabaseSync, action: (db: DatabaseSync) => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = action(db);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function isConstraint(error: unknown): boolean {
  return error instanceof Error && /constraint/i.test(error.message);
}
