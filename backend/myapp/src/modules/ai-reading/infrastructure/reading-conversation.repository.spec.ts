import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteService } from '../../../platform/persistence/sqlite/sqlite.service';
import {
  BookScope,
  ConversationCheckpoint,
  ConversationTurn,
  ReadingConversation,
  ReadingTask,
} from '../domain';
import { ReadingConversationRepository } from './reading-conversation.repository';

const NOW = '2026-08-16T00:00:00.000Z';

describe('ReadingConversationRepository', () => {
  let directory: string;
  let sqlite: SqliteService;
  let repository: ReadingConversationRepository;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'reading-conversation-'));
    process.env.SQLITE_PATH = join(directory, 'test.sqlite');
    sqlite = new SqliteService();
    sqlite.onModuleInit();
    seed(sqlite);
    repository = new ReadingConversationRepository(sqlite);
  });

  afterEach(() => {
    sqlite.onApplicationShutdown();
    delete process.env.SQLITE_PATH;
    rmSync(directory, { recursive: true, force: true });
  });

  it('atomically creates a conversation, first turn, and independently budgeted task', () => {
    const result = repository.createWithTurn({
      conversation: conversation('conversation-1'), turn: turn('conversation-1', 'turn-1', 'task-1', 1),
      task: task('task-1'), maxActiveTurns: 2,
    });

    expect(result).toBe('created');
    expect(repository.findForUser('conversation-1', 1)?.contentRevision).toBe('revision-1');
    expect(repository.findTurnForUser('conversation-1', 'turn-1', 1)?.taskId).toBe('task-1');
    expect(sqlite.getDatabase().prepare('SELECT COUNT(1) AS count FROM ai_reading_task_budgets WHERE task_id = ?')
      .get('task-1')).toEqual({ count: 1 });
    expect(sqlite.getDatabase().prepare('SELECT schema_version,status,depth FROM ai_reading_agent_runs WHERE task_id = ?')
      .get('task-1')).toEqual({ schema_version: 2, status: 'queued', depth: 0 });
    const event = sqlite.getDatabase().prepare(
      'SELECT type,payload_json FROM ai_reading_events WHERE task_id = ? AND sequence = 1',
    ).get('task-1') as unknown as { type: string; payload_json: string };
    expect(event.type).toBe('task_queued');
    expect(JSON.parse(event.payload_json)).toMatchObject({
      schemaVersion: 2, kind: 'task', detail: { status: 'queued', budgetTier: 'quick' },
    });
  });

  it('enforces one active turn per conversation and two across the service', () => {
    expect(create('conversation-1', 'turn-1', 'task-1')).toBe('created');
    expect(repository.addTurn({
      conversation: repository.findForUser('conversation-1', 1)!,
      turn: turn('conversation-1', 'turn-2', 'task-2', 2), task: task('task-2'), maxActiveTurns: 2,
    })).toBe('conversation_turn_active');

    expect(create('conversation-2', 'turn-3', 'task-3')).toBe('created');
    expect(create('conversation-3', 'turn-4', 'task-4')).toBe('service_turn_limit');
  });

  it('stores one immutable checkpoint per through turn', () => {
    create('conversation-1', 'turn-1', 'task-1');
    const checkpoint = ConversationCheckpoint.create({
      id: 'checkpoint-1', conversationId: 'conversation-1', throughTurnId: 'turn-1',
      memory: { turnSummaries: [], findings: [], preferences: [], topics: [], openQuestions: [],
        planSteps: [], chapterRanges: [], sourceEvidenceRefs: [] }, now: NOW,
    });

    expect(repository.appendCheckpoint(checkpoint)).toBe(true);
    expect(repository.appendCheckpoint(checkpoint)).toBe(false);
    expect(repository.latestCheckpoint('conversation-1', 1)?.toJSON()).toEqual(checkpoint.toJSON());
  });

  it('blocks active deletion and cascades terminal task data with the conversation', () => {
    create('conversation-1', 'turn-1', 'task-1');
    expect(repository.deleteForUser('conversation-1', 1)).toBe('active');

    const storedTask = task('task-1');
    storedTask.cancel('user_cancelled', '2026-08-16T00:01:00.000Z');
    repository.syncTurnFromTask(storedTask);
    expect(repository.deleteForUser('conversation-1', 1)).toBe('deleted');
    expect(sqlite.getDatabase().prepare('SELECT 1 FROM ai_reading_tasks WHERE id = ?').get('task-1')).toBeUndefined();
    expect(repository.findForUser('conversation-1', 1)).toBeNull();
  });

  it('deletes a terminal retry chain without violating the retry source foreign key', () => {
    create('conversation-1', 'turn-1', 'task-1');
    const sourceTask = task('task-1');
    sourceTask.fail('MODEL_CONNECTION_FAILED', '2026-08-16T00:01:00.000Z');
    repository.syncTurnFromTask(sourceTask);
    const sourceTurn = repository.findTurnForUser('conversation-1', 'turn-1', 1)!;
    const retryTask = task('task-2');
    const retryTurn = ConversationTurn.createRetry({
      source: sourceTurn, id: 'turn-2', taskId: 'task-2', turnNumber: 2,
      now: '2026-08-16T00:02:00.000Z',
    });
    expect(repository.addTurn({
      conversation: repository.findForUser('conversation-1', 1)!,
      turn: retryTurn, task: retryTask, maxActiveTurns: 2,
    })).toBe('created');
    retryTask.cancel('user_cancelled', '2026-08-16T00:03:00.000Z');
    repository.syncTurnFromTask(retryTask);

    expect(repository.deleteForUser('conversation-1', 1)).toBe('deleted');
    expect(repository.findForUser('conversation-1', 1)).toBeNull();
    expect(sqlite.getDatabase().prepare('SELECT COUNT(1) AS count FROM ai_reading_tasks WHERE id IN (?,?)')
      .get('task-1', 'task-2')).toEqual({ count: 0 });
  });

  function create(conversationId: string, turnId: string, taskId: string) {
    return repository.createWithTurn({
      conversation: conversation(conversationId), turn: turn(conversationId, turnId, taskId, 1),
      task: task(taskId), maxActiveTurns: 2,
    });
  }
});

function conversation(id: string) {
  return ReadingConversation.create({
    id, userId: '1', bookId: '1', contentRevision: 'revision-1', rootGoal: '理解作者如何建立全书核心论证',
    profileSnapshot: profile(), now: NOW,
  });
}

function turn(conversationId: string, id: string, taskId: string, turnNumber: number) {
  return ConversationTurn.create({ id, conversationId, taskId, turnNumber, userInput: '请解释这一部分', now: NOW });
}

function task(id: string) {
  return ReadingTask.create({
    id, userId: '1', goal: '理解作者如何建立全书核心论证', budgetTier: 'quick', bookAnalysis: profile(),
    scope: BookScope.create({ userId: '1', bookId: '1', contentRevision: 'revision-1' }), now: NOW,
  });
}

function profile() {
  return {
    profileId: 'profile-1', primaryGenre: 'nonfiction', secondaryGenres: [], traits: [], confidence: 0.9,
    classificationSummary: 'Argumentative nonfiction.',
    contentRevision: { fileChecksum: 'revision-1', extractorVersion: 'epub-v1', normalizationVersion: 'text-v1' },
    modelId: 'deepseek-v4-flash', strategyVersion: 'book-profile-v1', analyzedAt: NOW,
    spoilerPolicy: 'avoid_unless_user_requests' as const,
  };
}

function seed(sqlite: SqliteService): void {
  const db = sqlite.getDatabase();
  db.prepare("INSERT INTO users (id,email,password_hash,created_at,updated_at) VALUES (1,'a@b.c','x',?,?)").run(NOW, NOW);
  db.prepare(`INSERT INTO books (id,user_id,title,title_normalized,authors_json,authors_text,
    version,created_at,updated_at) VALUES (1,1,'Book','book','[]','',1,?,?)`).run(NOW, NOW);
}
