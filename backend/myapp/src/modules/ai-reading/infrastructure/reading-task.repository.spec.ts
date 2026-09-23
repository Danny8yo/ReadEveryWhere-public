import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteService } from "../../../platform/persistence/sqlite/sqlite.service";
import type { TaskWriteAuthority } from "../application/ports/reading-task-store.port";
import {
  createTaskEventPayload,
  createToolObservationPayload,
  createToolStartedPayload,
} from "../application/public-reading-event";
import { BookScope, ReadingEvent, ReadingTask } from "../domain";
import { ReadingTaskRepository } from "./reading-task.repository";
import { LEGACY_AI_READING_PROFILE_SNAPSHOT } from "../../../../test/fixtures/book-profile-aggregation";

describe("ReadingTaskRepository", () => {
  let directory: string;
  let sqlite: SqliteService;
  let repository: ReadingTaskRepository;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "rew-ai-task-"));
    process.env.SQLITE_PATH = join(directory, "test.sqlite");
    sqlite = new SqliteService();
    sqlite.onModuleInit();
    seedUserAndBook(sqlite, 1, 11);
    seedUserAndBook(sqlite, 2, 22);
    repository = new ReadingTaskRepository(sqlite);
  });

  afterEach(() => {
    sqlite.onApplicationShutdown();
    rmSync(directory, { recursive: true, force: true });
    delete process.env.SQLITE_PATH;
  });

  it("persists V2 task aggregates and isolates detail by owner", () => {
    repository.create(task("task-1", 1, 11));
    repository.create(task("task-2", 2, 22));

    expect(repository.findForUser("task-1", 1)?.id).toBe("task-1");
    expect(repository.findForUser("task-1", 2)).toBeNull();
    expect(sqlite.getDatabase().prepare(
      "SELECT schema_version FROM ai_reading_tasks WHERE id = 'task-1'",
    ).get()).toEqual({ schema_version: 2 });
  });

  it("round-trips an immutable custom budget snapshot", () => {
    const aggregate = customTask("task-custom", 1, 11);
    repository.create(aggregate);

    const row = sqlite.getDatabase().prepare(`
      SELECT budget_tier, state_json FROM ai_reading_tasks WHERE id = ?
    `).get("task-custom") as unknown as { budget_tier: string; state_json: string };
    expect(row.budget_tier).toBe("standard");
    expect(JSON.parse(row.state_json)).toMatchObject({
      budgetTier: "standard",
      budgetMode: "custom",
      budget: { policy: { maxReadCharacters: 1_000_000, maxConcurrentAgents: 3 } },
    });
    expect(repository.findForUser("task-custom", 1)?.toJSON()).toEqual(aggregate.toJSON());
  });

  it("冻结既有 AI Reading 数值 confidence 画像快照，不在画像迁移时反查或改写", () => {
    const aggregate = createTask(
      "task-legacy-profile",
      1,
      11,
      "quick",
      undefined,
      LEGACY_AI_READING_PROFILE_SNAPSHOT,
    );
    repository.create(aggregate);

    expect(repository.findForUser("task-legacy-profile", 1)?.toJSON().bookAnalysis)
      .toEqual(LEGACY_AI_READING_PROFILE_SNAPSHOT);
  });

  it("persists cancellation and releases V2 run reservations", () => {
    const aggregate = task("task-1", 1, 11);
    aggregate.start("root-run", new Date().toISOString());
    repository.create(aggregate);

    const cancelled = repository.cancelForUser("task-1", 1, new Date().toISOString());

    expect(cancelled?.status).toBe("cancelled");
    expect(repository.findForUser("task-1", 1)?.status).toBe("cancelled");
    expect(repository.isCancellationRequested("task-1")).toBe(true);
    const events = repository.listEvents("task-1", 1, 0, 20).items;
    expect(events[events.length - 1]?.type).toBe("task_cancelled");
    repository.save(aggregate, SYSTEM_AUTHORITY);
    expect(repository.findForUser("task-1", 1)?.status).toBe("cancelled");
  });

  it("assigns monotonically increasing event sequences under interleaved agents", () => {
    repository.create(task("task-1", 1, 11));
    const first = repository.appendEvent(event("task-1", "agent-a", "tool_started"), SYSTEM_AUTHORITY)!;
    const second = repository.appendEvent(event("task-1", "agent-b", "tool_observation"), SYSTEM_AUTHORITY)!;

    expect([first.sequence, second.sequence]).toEqual([1, 2]);
    expect(repository.listEvents("task-1", 1, 1, 100)).toMatchObject({
      items: [{ sequence: 2, agentRunId: "agent-b" }],
      nextSequence: 2,
    });
  });

  it("restores the complete public event payload after reopening SQLite", () => {
    repository.create(task("task-restart-detail", 1, 11));
    const persisted = repository.appendEvent({
      ...event("task-restart-detail", "agent-a", "tool_observation"),
      payload: createToolObservationPayload("book_read", {
        text: "可恢复的公开摘录",
        reachedSectionStart: true,
        reachedSectionEnd: true,
      }, {
        durationMs: 12,
        readSource: {
          text: "可恢复的公开摘录",
          segments: [{
            textStart: 0,
            textEnd: 9,
            citation: {
              bookId: 11,
              bookTitle: "Fixture",
              authors: [],
              chapterPath: "第一章",
              locator: {
                version: 1,
                position: { kind: "epub_text", sectionIndex: 0, start: 0, end: 9 },
              },
            },
          }],
        },
      }),
    }, SYSTEM_AUTHORITY)!;

    sqlite.onApplicationShutdown();
    sqlite = new SqliteService();
    sqlite.onModuleInit();
    repository = new ReadingTaskRepository(sqlite);

    expect(repository.listEvents("task-restart-detail", 1, 0, 20).items[0]).toEqual(persisted);
    expect((persisted.payload as any).detail.result.excerpt).toBe("可恢复的公开摘录");
  });

  it("preserves V1 rows and children as well as V2 data on startup", () => {
    repository.create(task("task-v2", 1, 11));
    const database = sqlite.getDatabase();
    database.prepare(`INSERT INTO ai_reading_tasks (
      id,user_id,book_id,content_revision,goal,budget_tier,status,state_json,
      cancel_requested,schema_version,created_at,updated_at
    ) SELECT 'task-v1',user_id,book_id,content_revision,goal,budget_tier,status,state_json,
      0,1,created_at,updated_at FROM ai_reading_tasks WHERE id='task-v2'`).run();
    database.prepare(`INSERT INTO ai_reading_events (
      task_id,sequence,type,occurred_at,payload_json
    ) VALUES ('task-v1',1,'task_started',?,?)`).run(
      new Date().toISOString(),
      JSON.stringify(createTaskEventPayload("task_started", { status: "running" })),
    );

    const originalTasks = database.prepare("SELECT * FROM ai_reading_tasks ORDER BY id").all();
    const originalEvents = database.prepare("SELECT * FROM ai_reading_events ORDER BY task_id, sequence").all();
    sqlite.onApplicationShutdown();
    sqlite = new SqliteService();
    sqlite.onModuleInit();

    expect(sqlite.getDatabase().prepare("SELECT * FROM ai_reading_tasks ORDER BY id").all()).toEqual(originalTasks);
    expect(sqlite.getDatabase().prepare("SELECT * FROM ai_reading_events ORDER BY task_id, sequence").all()).toEqual(originalEvents);
    expect(sqlite.getDatabase().prepare(
      "SELECT schema_version,COUNT(*) AS count FROM ai_reading_tasks GROUP BY schema_version ORDER BY schema_version",
    ).all()).toEqual([{ schema_version: 1, count: 1 }, { schema_version: 2, count: 1 }]);
    expect(sqlite.getDatabase().prepare(
      "SELECT COUNT(*) AS count FROM ai_reading_events WHERE task_id='task-v1'",
    ).get()).toEqual({ count: 1 });
    expect(sqlite.getDatabase().prepare(
      "SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_ai_reading_tasks_claim'",
    ).get()).toBeUndefined();
  });

  it("redacts secrets and reasoning while bounding persisted audit strings", () => {
    const aggregate = task("task-1", 1, 11);
    aggregate.start("root-run", new Date().toISOString());
    repository.create(aggregate);

    repository.appendAudit("task-1", "root-run", "model_call", {
      apiKey: "sk-private",
      Authorization: "Bearer private",
      reasoning_content: "hidden chain of thought",
      systemPrompt: "private instructions",
      resultSummary: "x".repeat(10_000),
    }, SYSTEM_AUTHORITY);

    const row = sqlite.getDatabase().prepare(`
      SELECT metadata_json FROM ai_reading_audit WHERE task_id = 'task-1'
    `).get() as { metadata_json: string };
    const metadata = JSON.parse(row.metadata_json);
    expect(metadata).toMatchObject({
      apiKey: "[Redacted]",
      Authorization: "[Redacted]",
      reasoning_content: "[Redacted]",
      systemPrompt: "[Redacted]",
    });
    expect(metadata.resultSummary).toHaveLength(4_000);
    expect(row.metadata_json).not.toContain("sk-private");
    expect(row.metadata_json).not.toContain("hidden chain of thought");
  });
});

function task(id: string, userId: number, bookId: number): ReadingTask {
  return createTask(id, userId, bookId, "quick");
}

function customTask(id: string, userId: number, bookId: number): ReadingTask {
  return createTask(id, userId, bookId, "standard", {
    maxModelTurns: 120,
    maxToolCalls: 180,
    maxReadCharacters: 1_000_000,
    maxDurationMs: 60 * 60_000,
    maxDelegatedAgents: 9,
    maxConcurrentAgents: 3,
  });
}

function createTask(
  id: string,
  userId: number,
  bookId: number,
  budgetTier: "quick" | "standard",
  budgetPolicy?: Parameters<typeof ReadingTask.create>[0]["budgetPolicy"],
  bookAnalysis?: Parameters<typeof ReadingTask.create>[0]["bookAnalysis"],
): ReadingTask {
  const revision = JSON.stringify({
    fileChecksum: "sha256:fixture",
    extractorVersion: "1",
    normalizationVersion: "1",
  });
  return ReadingTask.create({
    id,
    userId: String(userId),
    goal: "Find the main argument",
    scope: BookScope.create({ userId: String(userId), bookId: String(bookId), contentRevision: revision }),
    budgetTier,
    budgetPolicy,
    bookAnalysis,
    now: new Date().toISOString(),
  });
}

function event(taskId: string, agentRunId: string, type: "tool_started" | "tool_observation") {
  const payload = type === "tool_started"
    ? createToolStartedPayload("book_read", { maxChars: 400 })
    : createToolObservationPayload("book_read", { text: "evidence" }, { durationMs: 1 });
  const value = ReadingEvent.create({
    sequence: 1,
    type,
    occurredAt: new Date().toISOString(),
    taskId,
    agentRunId,
    payload,
  }).toJSON();
  const { sequence: _sequence, ...withoutSequence } = value;
  return withoutSequence;
}

function seedUserAndBook(sqlite: SqliteService, userId: number, bookId: number): void {
  const now = new Date().toISOString();
  sqlite.getDatabase().prepare(`
    INSERT INTO users (id, email, password_hash, created_at, updated_at)
    VALUES (?, ?, 'hash', ?, ?)
  `).run(userId, `reader-${userId}@example.com`, now, now);
  sqlite.getDatabase().prepare(`
    INSERT INTO books (
      id, user_id, title, title_normalized, authors_json, authors_text,
      version, created_at, updated_at
    ) VALUES (?, ?, 'Fixture', 'fixture', '[]', '', 1, ?, ?)
  `).run(bookId, userId, now, now);
}

const SYSTEM_AUTHORITY: TaskWriteAuthority = { kind: "system" };
