import { LibrarySyncState } from "../../library-sync/library-sync-state";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteService } from "../../../../platform/persistence/sqlite/sqlite.service";
import { BookAnalysisTask } from "../domain/book-analysis-task";
import { BookReadingProfileCandidate } from "../domain/book-reading-profile-candidate";
import { BookAnalysisRepository } from "./book-analysis.repository";
import {
  LEGACY_MULTI_PROFILE_FIXTURE,
  LEGACY_PROFILE_REVISION,
  LEGACY_STALE_PROFILE_REVISION,
} from "../../../../../test/fixtures/book-profile-aggregation";

const REVISION = { fileChecksum: "sha256:v1", extractorVersion: "epub-1", normalizationVersion: "text-1" };

describe("BookAnalysisRepository", () => {
  let directory: string;
  let sqlite: SqliteService;
  let sync: LibrarySyncState;
  let repository: BookAnalysisRepository;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "rew-book-analysis-"));
    process.env.SQLITE_PATH = join(directory, "test.sqlite");
    sqlite = new SqliteService();
    sqlite.onModuleInit();
    seedUserAndBook(sqlite);
    sync = new LibrarySyncState();
    repository = new BookAnalysisRepository(sqlite, sync);
  });

  afterEach(() => {
    sqlite.onApplicationShutdown();
    rmSync(directory, { recursive: true, force: true });
    delete process.env.SQLITE_PATH;
  });

  it("持久化画像并按当前 revision/策略返回 ready 或 stale", () => {
    repository.saveProfile(BookReadingProfileCandidate.create({
      id: "profile-1", userId: 7, bookId: 42,
      primaryGenre: "technical", secondaryGenres: [], traits: ["linear"], confidence: 0.9,
      classificationSummary: "A linear technical structure.", contentRevision: REVISION,
      modelId: "deepseek-v4-flash", strategyVersion: "book-profile-v1",
      analyzedAt: "2026-08-08T00:00:00.000Z",
    }), 1);

    expect(sync.version(7).revision).toBe(1);
    expect(repository.getSnapshot(7, 42, REVISION, "book-profile-v1")).toMatchObject({
      status: "ready", stale: false, candidate: { primaryGenre: "technical" },
    });
    expect(repository.getSnapshot(7, 42, { ...REVISION, fileChecksum: "sha256:v2" }, "book-profile-v1")).toMatchObject({
      status: "stale", stale: true, candidate: null,
    });
  });

  it("冻结多画像迁移基线：只选择当前 revision/策略下 analyzedAt 最新的画像", () => {
    for (const value of LEGACY_MULTI_PROFILE_FIXTURE) {
      repository.saveProfile(BookReadingProfileCandidate.create(value), 1);
    }

    expect(repository.getSnapshot(7, 42, LEGACY_PROFILE_REVISION, "book-profile-v1"))
      .toMatchObject({
        status: "ready",
        stale: false,
        candidate: {
          id: "profile-current-latest",
          baseProfileVersion: 1,
          primaryGenre: "argumentation",
          traits: ["claim-driven", "evidence-heavy"],
        },
      });
  });

  it("冻结 stale-only 与从未分析基线", () => {
    repository.saveProfile(BookReadingProfileCandidate.create(LEGACY_MULTI_PROFILE_FIXTURE[0]), 1);

    expect(repository.getSnapshot(7, 42, LEGACY_PROFILE_REVISION, "book-profile-v1"))
      .toEqual({ status: "stale", stale: true, candidate: null, errorCode: null });

    sqlite.getDatabase().prepare("DELETE FROM book_analysis_candidates WHERE book_id = 42").run();
    expect(repository.getSnapshot(7, 42, LEGACY_PROFILE_REVISION, "book-profile-v1"))
      .toEqual({ status: "not_analyzed", stale: false, candidate: null, errorCode: null });

    expect(repository.getSnapshot(7, 42, LEGACY_STALE_PROFILE_REVISION, "book-profile-v1"))
      .toEqual({ status: "not_analyzed", stale: false, candidate: null, errorCode: null });
  });

  it("生成新候选时使旧 pending 候选失效且不修改正式画像", () => {
    repository.saveProfile(BookReadingProfileCandidate.create({
      id: "candidate-old", userId: 7, bookId: 42,
      primaryGenre: "technical", secondaryGenres: [], traits: [], confidence: 0.8,
      classificationSummary: "old", contentRevision: REVISION,
      modelId: "deepseek-v4-flash", strategyVersion: "book-profile-v1",
      analyzedAt: "2026-08-08T00:00:00.000Z",
    }), 1);
    repository.saveProfile(BookReadingProfileCandidate.create({
      id: "candidate-new", userId: 7, bookId: 42,
      primaryGenre: "argumentation", secondaryGenres: [], traits: ["claim-driven"], confidence: 0.9,
      classificationSummary: "new", contentRevision: REVISION,
      modelId: "deepseek-v4-flash", strategyVersion: "book-profile-v1",
      analyzedAt: "2026-08-08T00:00:01.000Z",
    }), 1);

    const rows = sqlite.getDatabase().prepare(
      "SELECT id, status FROM book_analysis_candidates WHERE book_id = 42 ORDER BY id",
    ).all() as Array<{ id: string; status: string }>;
    expect(rows).toEqual([
      { id: "candidate-new", status: "pending" },
      { id: "candidate-old", status: "superseded" },
    ]);
    expect(sqlite.getDatabase().prepare(
      "SELECT 1 FROM book_profiles WHERE book_id = 42",
    ).get()).toBeUndefined();
  });

  it("atomically rolls back candidate consumption when Catalog application fails", () => {
    repository.saveProfile(BookReadingProfileCandidate.create({
      id: "candidate-rollback", userId: 7, bookId: 42,
      primaryGenre: "technical", secondaryGenres: [], traits: [], confidence: 0.8,
      classificationSummary: "candidate", contentRevision: REVISION,
      modelId: "deepseek-v4-flash", strategyVersion: "book-profile-v1",
      analyzedAt: "2026-08-08T00:00:00.000Z",
    }), 1);

    expect(() => repository.consumeCandidate("candidate-rollback", () => {
      throw new Error("catalog write failed");
    })).toThrow("catalog write failed");
    expect(repository.getCandidate(7, "candidate-rollback")?.status).toBe("pending");
  });

  it("reports an applied candidate as ready without leaving it re-applicable", () => {
    repository.saveProfile(BookReadingProfileCandidate.create({
      id: "candidate-applied", userId: 7, bookId: 42,
      primaryGenre: "technical", secondaryGenres: [], traits: [], confidence: 0.8,
      classificationSummary: "candidate", contentRevision: REVISION,
      modelId: "deepseek-v4-flash", strategyVersion: "book-profile-v1",
      analyzedAt: "2026-08-08T00:00:00.000Z",
    }), 1);
    repository.consumeCandidate("candidate-applied", () => undefined);

    expect(repository.getSnapshot(7, 42, REVISION, "book-profile-v1")).toMatchObject({
      status: "ready",
      stale: false,
      candidate: { id: "candidate-applied", status: "applied" },
      errorCode: null,
    });
  });

  it("只允许一个 worker claim；lease 过期后可由新 worker 恢复", () => {
    repository.enqueueIfAbsent(BookAnalysisTask.create({
      id: "task-1", userId: 7, bookId: 42, contentRevision: REVISION,
      modelId: "deepseek-v4-flash", strategyVersion: "book-profile-v1",
      requestedAt: "2026-08-08T00:00:00.000Z",
    }));
    const first = repository.claimNext("worker-a", "2026-08-08T00:00:01.000Z", 1_000);
    expect(first).toMatchObject({ resumed: false, task: { id: "task-1", status: "running" } });
    expect(repository.claimNext("worker-b", "2026-08-08T00:00:01.500Z", 1_000)).toBeNull();

    const resumed = repository.claimNext("worker-b", "2026-08-08T00:00:02.001Z", 1_000);
    expect(resumed).toMatchObject({ resumed: true, task: { id: "task-1", status: "running" } });
    expect(resumed?.lease.generation).toBe(2);
  });
});

function seedUserAndBook(sqlite: SqliteService) {
  const db = sqlite.getDatabase();
  db.prepare("INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(7, "analysis@example.com", "hash", "2026-08-08T00:00:00.000Z", "2026-08-08T00:00:00.000Z");
  db.prepare(`INSERT INTO books (
    id, user_id, title, title_normalized, authors_json, authors_text,
    version, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(42, 7, "Book", "book", "[]", "", 1, "2026-08-08T00:00:00.000Z", "2026-08-08T00:00:00.000Z");
}
