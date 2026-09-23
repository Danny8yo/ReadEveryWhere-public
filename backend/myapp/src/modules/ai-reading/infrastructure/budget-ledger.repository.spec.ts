import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteService } from "../../../platform/persistence/sqlite/sqlite.service";
import { BudgetLedgerRepository } from "./budget-ledger.repository";
import { ReadingTaskRepository } from "./reading-task.repository";
import { BookScope, ReadingTask } from "../domain";
import { AgentRunRepository } from "./agent-run.repository";
import type { AgentRunLease, AgentRunRecordV2 } from "../application/ports/agent-run-store.port";

describe("BudgetLedgerRepository atomic reservations", () => {
  let directory: string;
  let sqlite: SqliteService;
  let repository: BudgetLedgerRepository;
  let leases: Record<string, AgentRunLease>;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "ai-budget-v2-"));
    process.env.SQLITE_PATH = join(directory, "test.sqlite");
    sqlite = new SqliteService();
    sqlite.onModuleInit();
    seed(sqlite);
    repository = new BudgetLedgerRepository(sqlite);
    const runs = new AgentRunRepository(sqlite);
    runs.create(run("run-1", "goal-one"));
    runs.create(run("run-2", "goal-two"));
    leases = {
      "run-1": runs.claimNext("worker-1", "2026-08-16T00:00:00.000Z")!.lease,
      "run-2": runs.claimNext("worker-2", "2026-08-16T00:00:00.000Z")!.lease,
    };
    repository.create({
      taskId: "task-v2",
      policy: { modelTurns: 1, toolCalls: 2, readCharacters: 100, delegatedAgents: 1,
        deadlineAt: "2026-08-16T00:00:30.000Z" },
      used: zero(), reserved: zero(), promptTokens: 0, completionTokens: 0, totalTokens: 0, version: 1,
    });
  });

  afterEach(() => {
    sqlite.onApplicationShutdown();
    delete process.env.SQLITE_PATH;
    rmSync(directory, { recursive: true, force: true });
  });

  it("never over-reserves the global task budget and makes retries idempotent", () => {
    expect(repository.reserve(request("reservation-1", "run-1", "step-1"), authority("run-1"))).toBe("reserved");
    expect(repository.reserve(request("reservation-1-retry", "run-1", "step-1"), authority("run-1"))).toBe("existing");
    expect(repository.reserve(request("reservation-2", "run-2", "step-2"), authority("run-2"))).toBe("exhausted");
    expect(repository.find("task-v2")?.reserved.modelTurns).toBe(1);

    expect(repository.settle("reservation-1", {
      amount: { modelTurns: 1 }, promptTokens: 10, completionTokens: 4, totalTokens: 14,
      cacheReadInputTokens: 7, cacheWriteInputTokens: 2, uncachedInputTokens: 3,
      settledAt: "2026-08-16T00:00:02.000Z",
    } as any, authority("run-1"))).toBe(true);
    expect(repository.settle("reservation-1", {
      amount: { modelTurns: 1 }, totalTokens: 14, settledAt: "2026-08-16T00:00:03.000Z",
    }, authority("run-1"))).toBe(true);
    expect(repository.find("task-v2")).toMatchObject({
      used: { modelTurns: 1 }, reserved: { modelTurns: 0 }, totalTokens: 14,
      cacheReadInputTokens: 7, cacheWriteInputTokens: 2, uncachedInputTokens: 3,
    });
  });

  it("checks node usage and the task deadline in the same reservation transaction", () => {
    expect(repository.reserve({ ...request("tool-1", "run-1", "tool-step-1"), kind: "tool",
      amount: { toolCalls: 2 }, nodeLimits: { modelTurns: 1, toolCalls: 1, readCharacters: 100 } }, authority("run-1")))
      .toBe("exhausted");
    expect(repository.reserve({ ...request("late", "run-1", "late-step"), now: "2026-08-16T00:00:30.000Z" }, {
      lease: leases["run-1"], now: "2026-08-16T00:00:30.000Z",
    }))
      .toBe("deadline");
  });

  it("fences an old worker before changing reservations or usage", () => {
    const runs = new AgentRunRepository(sqlite);
    const oldLease = leases["run-1"];
    const replacement = runs.claimNext("worker-new", oldLease.expiresAt)!.lease;

    expect(repository.reserve(request("stale", "run-1", "stale-step"), {
      lease: oldLease, now: oldLease.expiresAt,
    })).toBe("fenced");
    expect(repository.reserve(request("current", "run-1", "current-step"), {
      lease: replacement, now: "2026-08-16T00:01:01.000Z",
    })).toBe("reserved");
  });

  function request(id: string, agentRunId: string, stepId: string) {
    return { id, taskId: "task-v2", agentRunId, stepId, kind: "model" as const,
      amount: { modelTurns: 1 }, nodeLimits: { modelTurns: 1, toolCalls: 1, readCharacters: 100 },
      now: "2026-08-16T00:00:01.000Z" };
  }

  function authority(agentRunId: string) {
    return { lease: leases[agentRunId], now: "2026-08-16T00:00:01.000Z" };
  }
});

function run(id: string, fingerprint: string): AgentRunRecordV2 {
  return { id, taskId: "task-v2", depth: 0, goal: "分析本书的核心论点和关键证据",
    deliverable: "给出结构化结论和可回读证据", goalFingerprint: fingerprint, status: "queued",
    checkpoint: { schemaVersion: 1, nextStepNo: 1, messages: [], childResultIds: [] },
    nodeLimits: { modelTurns: 1, toolCalls: 1, readCharacters: 100, executionMs: 120_000 },
    cancelRequested: false, createdAt: `2026-08-16T00:00:0${id === "run-1" ? 0 : 1}.000Z`,
    updatedAt: "2026-08-16T00:00:00.000Z" };
}

function zero() { return { modelTurns: 0, toolCalls: 0, readCharacters: 0, delegatedAgents: 0 }; }

function seed(sqlite: SqliteService): void {
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
