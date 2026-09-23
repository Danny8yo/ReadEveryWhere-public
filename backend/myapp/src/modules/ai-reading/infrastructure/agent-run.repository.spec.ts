import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteService } from "../../../platform/persistence/sqlite/sqlite.service";
import type { AgentRunRecordV2 } from "../application/ports/agent-run-store.port";
import { AgentRunRepository } from "./agent-run.repository";
import { ReadingTaskRepository } from "./reading-task.repository";
import { BookScope, ConversationCheckpoint, ReadingTask } from "../domain";
import { createAgentEventPayload, createTaskEventPayload } from "../application/public-reading-event";

describe("AgentRunRepository V2 concurrency", () => {
  let directory: string;
  let sqlite: SqliteService;
  let repository: AgentRunRepository;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "ai-run-v2-"));
    process.env.SQLITE_PATH = join(directory, "test.sqlite");
    sqlite = new SqliteService();
    sqlite.onModuleInit();
    seedTask(sqlite);
    repository = new AgentRunRepository(sqlite);
  });

  afterEach(() => {
    sqlite.onApplicationShutdown();
    delete process.env.SQLITE_PATH;
    rmSync(directory, { recursive: true, force: true });
  });

  it("fences checkpoint and step writes after an expired run is reclaimed", () => {
    repository.create(run());
    const oldClaim = repository.claimNext("worker-old", "2026-08-16T00:00:00.000Z")!;
    const newClaim = repository.claimNext("worker-new", oldClaim.lease.expiresAt)!;

    const stale = { ...oldClaim.run, status: "running" as const, checkpoint: {
      ...oldClaim.run.checkpoint, nextStepNo: 2,
    } };
    expect(repository.save(stale, { lease: oldClaim.lease, now: newClaim.lease.expiresAt })).toBe(false);
    expect(repository.startStep(step("stale-step"), {
      lease: oldClaim.lease,
      now: newClaim.lease.expiresAt,
    })).toBeNull();

    const current = { ...newClaim.run, status: "running" as const, checkpoint: {
      ...newClaim.run.checkpoint, nextStepNo: 2,
    } };
    expect(repository.save(current, { lease: newClaim.lease, now: "2026-08-16T00:01:01.000Z" })).toBe(true);
    expect(repository.startStep(step("current-step"), {
      lease: newClaim.lease,
      now: "2026-08-16T00:01:01.000Z",
    })?.id).toBe("current-step");
  });

  it("returns the existing step for an idempotent retry and rejects a conflicting payload", () => {
    repository.create(run());
    const claim = repository.claimNext("worker", "2026-08-16T00:00:00.000Z")!;
    const authority = { lease: claim.lease, now: "2026-08-16T00:00:01.000Z" };

    expect(repository.startStep(step("step-one"), authority)?.id).toBe("step-one");
    expect(repository.startStep(step("step-one-retry"), authority)?.id).toBe("step-one");
    expect(() => repository.startStep({ ...step("step-conflict"), requestFingerprint: "different" }, authority))
      .toThrow("AGENT_STEP_CONFLICT");
  });

  it("enforces a global running cap and resumes a waiting parent only after every direct child is terminal", () => {
    repository.create(run("run-parent"));
    const parentClaim = repository.claimNext("worker-parent", "2026-08-16T00:00:00.000Z", 1)!;
    expect(parentClaim.run.id).toBe("run-parent");
    repository.create({ ...run("run-other"), goalFingerprint: "other" });
    expect(repository.claimNext("worker-other", "2026-08-16T00:00:01.000Z", 1)).toBeNull();

    const waiting = { ...parentClaim.run, status: "waiting_children" as const, updatedAt: "2026-08-16T00:00:01.000Z" };
    expect(repository.save(waiting, { lease: parentClaim.lease, now: waiting.updatedAt })).toBe(true);
    repository.create({ ...run("child-1"), parentRunId: "run-parent", depth: 1, goalFingerprint: "child-1" });
    repository.create({ ...run("child-2"), parentRunId: "run-parent", depth: 1, goalFingerprint: "child-2" });

    expect(repository.resumeReadyParents("2026-08-16T00:00:02.000Z")).toBe(0);
    finish("child-1", "2026-08-16T00:00:03.000Z");
    expect(repository.resumeReadyParents("2026-08-16T00:00:04.000Z")).toBe(0);
    finish("child-2", "2026-08-16T00:00:05.000Z");
    expect(repository.resumeReadyParents("2026-08-16T00:00:06.000Z")).toBe(1);
    expect(repository.find("run-parent")?.status).toBe("queued");
  });

  it("creates a delegated batch and step atomically and returns it on idempotent recovery", () => {
    repository.create(run());
    const claim = repository.claimNext("worker", "2026-08-16T00:00:00.000Z")!;
    const parent = {
      ...claim.run,
      status: "waiting_children" as const,
      checkpoint: { ...claim.run.checkpoint, nextStepNo: 2 },
      updatedAt: "2026-08-16T00:00:01.000Z",
    };
    const stepRecord = { ...step("delegate-step"), kind: "delegate" as const, toolCallId: "call-1" };
    const children = [
      { ...run("child-a"), parentRunId: run().id, depth: 1, goalFingerprint: "child-a" },
      { ...run("child-b"), parentRunId: run().id, depth: 1, goalFingerprint: "child-b" },
    ];

    expect(repository.createDelegatedChildren({
      parent, children, step: stepRecord, authority: { lease: claim.lease, now: parent.updatedAt },
    })).toBe("created");
    expect(repository.createDelegatedChildren({
      parent, children, step: stepRecord, authority: { lease: claim.lease, now: parent.updatedAt },
    })).toBe("fenced");
    expect(repository.listForTask("task-v2").filter((item) => item.parentRunId === run().id)).toHaveLength(2);
  });

  it("rechecks the per-depth width inside the delegated batch transaction", () => {
    repository.create({
      ...run("existing-child-a"), parentRunId: "another-parent", depth: 1,
      goalFingerprint: "existing-child-a", status: "completed", finishedAt: "2026-08-16T00:00:00.000Z",
    });
    repository.create({
      ...run("existing-child-b"), parentRunId: "another-parent", depth: 1,
      goalFingerprint: "existing-child-b", status: "completed", finishedAt: "2026-08-16T00:00:00.000Z",
    });
    repository.create(run());
    const claim = repository.claimNext("worker", "2026-08-16T00:00:00.000Z")!;
    const parent = {
      ...claim.run,
      status: "waiting_children" as const,
      updatedAt: "2026-08-16T00:00:01.000Z",
    };
    const children = [
      { ...run("new-child-a"), parentRunId: parent.id, depth: 1, goalFingerprint: "new-child-a" },
      { ...run("new-child-b"), parentRunId: parent.id, depth: 1, goalFingerprint: "new-child-b" },
    ];

    expect(() => repository.createDelegatedChildren({
      parent,
      children,
      step: { ...step("width-race-step"), kind: "delegate", toolCallId: "width-race-call" },
      authority: { lease: claim.lease, now: parent.updatedAt },
    })).toThrow("DELEGATION_LAYER_EXCEEDED");
    expect(repository.listForTask("task-v2").filter((item) => item.depth === 1)).toHaveLength(2);
    expect(repository.findStep(parent.id, 1)).toBeNull();
    expect(repository.find(parent.id)?.status).toBe("running");
  });

  it('enforces the frozen per-task child concurrency below the service-wide cap', () => {
    repository.create({ ...run('run-1'), parentRunId: 'root', depth: 1 });
    repository.create({ ...run('run-2'), parentRunId: 'root', depth: 1,
      goal: '核验第二条独立分析路径的论证结构' });
    sqlite.getDatabase().prepare(`INSERT INTO ai_reading_task_budgets
      (task_id,schema_version,policy_json,deadline_at,version) VALUES (?,2,?,?,1)`)
      .run('task-v2', JSON.stringify({ modelTurns: 10, toolCalls: 10, readCharacters: 10000,
        delegatedAgents: 3, concurrentAgents: 1, deadlineAt: '2099-01-01T00:00:00.000Z' }),
      '2099-01-01T00:00:00.000Z');

    expect(repository.claimNext('worker-1', '2026-08-16T00:00:00.000Z', 4)?.run.id).toBe('run-1');
    expect(repository.claimNext('worker-2', '2026-08-16T00:00:00.000Z', 4)).toBeNull();
  });

  it('allows a quick root claim when delegated child concurrency is zero', () => {
    repository.create(run('quick-root'));
    sqlite.getDatabase().prepare(`INSERT INTO ai_reading_task_budgets
      (task_id,schema_version,policy_json,deadline_at,version) VALUES (?,2,?,?,1)`)
      .run('task-v2', JSON.stringify({ modelTurns: 10, toolCalls: 10, readCharacters: 10000,
        delegatedAgents: 0, concurrentAgents: 0, deadlineAt: '2099-01-01T00:00:00.000Z' }),
      '2099-01-01T00:00:00.000Z');

    expect(repository.claimNext('worker-quick', '2026-08-16T00:00:00.000Z', 4)?.run.id)
      .toBe('quick-root');
  });

  it('skips an in-process active run without consuming a new lease generation', () => {
    repository.create(run('run-1'));
    repository.create({ ...run('run-2'), goal: '核验另一条独立证据路径的论证限制' });

    const first = repository.claimNext('worker-1', '2026-08-16T00:00:00.000Z', 4)!;
    expect(first.run.id).toBe('run-1');
    expect(repository.save({ ...first.run, status: 'queued', updatedAt: '2026-08-16T00:00:01.000Z' }, {
      lease: first.lease, now: '2026-08-16T00:00:01.000Z',
    })).toBe(true);

    const second = repository.claimNext(
      'worker-2', '2026-08-16T00:00:02.000Z', 4, ['run-1'],
    )!;

    expect(second.run.id).toBe('run-2');
    expect(sqlite.getDatabase().prepare(
      'SELECT lease_generation FROM ai_reading_agent_runs WHERE id=?',
    ).get('run-1')).toEqual({ lease_generation: 1 });
  });

  it('atomically commits a root terminal task, turn, checkpoint, run and public events', () => {
    seedConversationTurn(sqlite);
    sqlite.getDatabase().prepare('UPDATE ai_reading_tasks SET schema_version=2 WHERE id=?').run('task-v2');
    sqlite.getDatabase().prepare(`INSERT INTO ai_reading_task_budgets
      (task_id,schema_version,policy_json,deadline_at,version) VALUES (?,2,?,?,1)`)
      .run('task-v2', JSON.stringify({ modelTurns: 10, toolCalls: 15, readCharacters: 30_000,
        delegatedAgents: 1, concurrentAgents: 1, deadlineAt: '2026-08-16T00:03:00.000Z' }),
      '2026-08-16T00:03:00.000Z');
    repository.create(run());
    const claim = repository.claimNext('worker-terminal', '2026-08-16T00:00:00.000Z')!;
    const tasks = new ReadingTaskRepository(sqlite);
    const task = tasks.findInternal('task-v2')!;
    task.start('embedded-root', '2026-08-16T00:00:01.000Z');
    expect(tasks.save(task, { kind: 'system' })).toBe(true);
    task.requestInput('请明确要继续核验的章节。', '2026-08-16T00:00:02.000Z');
    const terminalRun = {
      ...claim.run, status: 'completed' as const, updatedAt: '2026-08-16T00:00:02.000Z',
      finishedAt: '2026-08-16T00:00:02.000Z',
    };
    const checkpoint = ConversationCheckpoint.create({
      id: 'checkpoint-terminal', conversationId: 'conversation-terminal', throughTurnId: 'turn-terminal',
      now: '2026-08-16T00:00:02.000Z',
      memory: {
        turnSummaries: [{ turnId: 'turn-terminal', summary: '需要用户澄清。' }], findings: [],
        preferences: [], topics: [], openQuestions: ['需要核验哪一章？'], planSteps: [],
        chapterRanges: [], sourceEvidenceRefs: [],
      },
    });
    const authority = { lease: claim.lease, now: '2026-08-16T00:00:02.000Z' };
    const events = [{
      type: 'agent_completed' as const, occurredAt: authority.now, taskId: task.id, agentRunId: terminalRun.id,
      payload: createAgentEventPayload('agent_completed', {
        role: 'root', goal: terminalRun.goal, status: 'completed', findingCount: 0, evidenceIds: [],
      }),
    }, {
      type: 'task_needs_input' as const, occurredAt: authority.now, taskId: task.id, agentRunId: terminalRun.id,
      payload: createTaskEventPayload('task_needs_input', { status: 'needs_input', reasonCode: 'REFERENCE_UNRESOLVED' }),
    }];

    expect(() => repository.commitTerminal({
      task, run: terminalRun, checkpoint, events: [{ ...events[1], payload: { secret: 'system prompt' } }], authority,
    })).toThrow();
    expect(tasks.findInternal(task.id)?.status).toBe('running');
    expect(repository.find(terminalRun.id)?.status).toBe('running');
    expect(sqlite.getDatabase().prepare('SELECT status FROM reading_conversation_turns WHERE id=?')
      .get('turn-terminal')).toEqual({ status: 'running' });
    expect(sqlite.getDatabase().prepare('SELECT COUNT(1) AS count FROM reading_conversation_checkpoints')
      .get()).toEqual({ count: 0 });

    expect(repository.commitTerminal({ task, run: terminalRun, checkpoint, events, authority })).toBe('committed');
    expect(tasks.findInternal(task.id)?.status).toBe('needs_input');
    expect(repository.find(terminalRun.id)?.status).toBe('completed');
    expect(sqlite.getDatabase().prepare(
      'SELECT status,clarification_question FROM reading_conversation_turns WHERE id=?',
    ).get('turn-terminal')).toEqual({
      status: 'needs_input', clarification_question: '请明确要继续核验的章节。',
    });
    expect(sqlite.getDatabase().prepare('SELECT through_turn_id FROM reading_conversation_checkpoints')
      .get()).toEqual({ through_turn_id: 'turn-terminal' });
    expect(sqlite.getDatabase().prepare(
      "SELECT COUNT(1) AS count FROM ai_reading_events WHERE task_id=? AND type IN ('agent_completed','task_needs_input')",
    ).get(task.id)).toEqual({ count: 2 });
  });

  function step(id: string) {
    return {
      id,
      taskId: "task-v2",
      agentRunId: "run-v2",
      stepNo: 1,
      kind: "model" as const,
      status: "started" as const,
      requestFingerprint: "same-request",
      createdAt: "2026-08-16T00:00:01.000Z",
    };
  }

  function finish(runId: string, now: string) {
    const claim = repository.claimNext(`worker-${runId}`, now)!;
    repository.save({ ...claim.run, status: "completed", finishedAt: now, updatedAt: now }, {
      lease: claim.lease, now,
    });
  }
});

function run(id = "run-v2"): AgentRunRecordV2 {
  return {
    id, taskId: "task-v2", depth: 0, goal: `分析本书的核心论点和关键证据 ${id}`,
    deliverable: "给出结构化结论和可回读证据", goalFingerprint: id === "run-v2" ? "root-goal" : id, status: "queued",
    checkpoint: { schemaVersion: 1, nextStepNo: 1, messages: [], childResultIds: [] },
    nodeLimits: { modelTurns: 100, toolCalls: 100, readCharacters: 100_000, executionMs: 300_000 },
    cancelRequested: false, createdAt: "2026-08-16T00:00:00.000Z", updatedAt: "2026-08-16T00:00:00.000Z",
  };
}

function seedTask(sqlite: SqliteService): void {
  const now = "2026-08-16T00:00:00.000Z";
  const db = sqlite.getDatabase();
  db.prepare("INSERT INTO users (id,email,password_hash,created_at,updated_at) VALUES (1,'a@b.c','x',?,?)").run(now, now);
  db.prepare(`INSERT INTO books (id,user_id,title,title_normalized,authors_json,authors_text,
    version,created_at,updated_at) VALUES (1,1,'Book','book','[]','',1,?,?)`).run(now, now);
  const task = ReadingTask.create({ id: "task-v2", userId: "1", goal: "分析本书的核心论点和关键证据",
    scope: BookScope.create({ userId: "1", bookId: "1", contentRevision: "revision-1" }),
    budgetTier: "quick", now });
  new ReadingTaskRepository(sqlite).create(task);
}

function seedConversationTurn(sqlite: SqliteService): void {
  const db = sqlite.getDatabase();
  const now = '2026-08-16T00:00:00.000Z';
  db.prepare(`INSERT INTO reading_conversations
    (id,user_id,book_id,content_revision,root_goal,status,profile_snapshot_json,created_at,updated_at)
    VALUES ('conversation-terminal',1,1,'revision-1','分析本书的核心论点和关键证据','active','{}',?,?)`).run(now, now);
  db.prepare(`INSERT INTO reading_conversation_turns
    (id,conversation_id,task_id,turn_number,user_input,status,created_at,updated_at)
    VALUES ('turn-terminal','conversation-terminal','task-v2',1,'请分析核心论证','queued',?,?)`).run(now, now);
}
