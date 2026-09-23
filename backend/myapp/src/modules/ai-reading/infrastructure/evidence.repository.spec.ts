import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteService } from "../../../platform/persistence/sqlite/sqlite.service";
import { BookScope, ReadingTask } from "../domain";
import { ReadingTaskRepository } from "./reading-task.repository";
import { AgentRunRepository } from "./agent-run.repository";
import { EvidenceRepository } from "./evidence.repository";

describe("EvidenceRepository incremental writes", () => {
  let directory: string;
  let sqlite: SqliteService;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "ai-evidence-v2-"));
    process.env.SQLITE_PATH = join(directory, "test.sqlite");
    sqlite = new SqliteService();
    sqlite.onModuleInit();
    seed(sqlite);
  });

  afterEach(() => {
    sqlite.onApplicationShutdown();
    delete process.env.SQLITE_PATH;
    rmSync(directory, { recursive: true, force: true });
  });

  it("appends evidence from parallel nodes without replacing siblings and fences old leases", () => {
    const runs = new AgentRunRepository(sqlite);
    runs.create(run("run-1", "goal-1", "2026-08-16T00:00:00.000Z"));
    runs.create(run("run-2", "goal-2", "2026-08-16T00:00:01.000Z"));
    const first = runs.claimNext("worker-1", "2026-08-16T00:00:00.000Z")!.lease;
    const second = runs.claimNext("worker-2", "2026-08-16T00:00:00.000Z")!.lease;
    const evidence = new EvidenceRepository(sqlite);

    expect(evidence.append(record("evidence-1", "run-1"), { lease: first, now: "2026-08-16T00:00:02.000Z" }))
      .toBe("inserted");
    expect(evidence.append(record("evidence-2", "run-2"), { lease: second, now: "2026-08-16T00:00:02.000Z" }))
      .toBe("inserted");
    expect(evidence.append(record("evidence-1", "run-1"), { lease: first, now: "2026-08-16T00:00:03.000Z" }))
      .toBe("existing");
    expect(evidence.listForTask("task-v2").map((item) => item.evidenceId)).toEqual(["evidence-1", "evidence-2"]);

    runs.claimNext("worker-new", first.expiresAt);
    expect(evidence.append(record("stale-evidence", "run-1"), { lease: first, now: first.expiresAt }))
      .toBe("fenced");
  });
});

function record(evidenceId: string, agentRunId: string) {
  return { evidenceId, taskId: "task-v2", agentRunId, quote: `quote-${agentRunId}`,
    citation: { bookId: "1", contentRevision: "revision-1", bookTitle: "Book", authors: [], chapterPath: "第一章",
      locator: { version: 1 as const, position: { kind: "epub_text" as const, sectionIndex: 0, start: 0, end: 5 } } },
    sourceTextHash: "a".repeat(64), provenanceKind: "read" as const,
    sourceLocator: { version: 1 as const, position: { kind: "epub_text" as const, sectionIndex: 0, start: 0, end: 5 } },
    createdAt: "2026-08-16T00:00:02.000Z" };
}

function run(id: string, fingerprint: string, createdAt: string) {
  return { id, taskId: "task-v2", depth: 0, goal: "分析本书的核心论点和关键证据",
    deliverable: "给出结构化结论和可回读证据", goalFingerprint: fingerprint, status: "queued" as const,
    checkpoint: { schemaVersion: 1 as const, nextStepNo: 1, messages: [], childResultIds: [] },
    nodeLimits: { modelTurns: 2, toolCalls: 2, readCharacters: 100, executionMs: 120_000 },
    cancelRequested: false, createdAt, updatedAt: createdAt };
}

function seed(sqlite: SqliteService): void {
  const now = "2026-08-16T00:00:00.000Z";
  const db = sqlite.getDatabase();
  db.prepare("INSERT INTO users (id,email,password_hash,created_at,updated_at) VALUES (1,'a@b.c','x',?,?)").run(now, now);
  db.prepare(`INSERT INTO books (id,user_id,title,title_normalized,authors_json,authors_text,
    version,created_at,updated_at) VALUES (1,1,'Book','book','[]','',1,?,?)`).run(now, now);
  new ReadingTaskRepository(sqlite).create(ReadingTask.create({ id: "task-v2", userId: "1", goal: "分析本书的核心论点和关键证据",
    scope: BookScope.create({ userId: "1", bookId: "1", contentRevision: "revision-1" }), budgetTier: "quick", now }));
}
