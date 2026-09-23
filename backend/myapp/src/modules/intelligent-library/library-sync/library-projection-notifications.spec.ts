import { DatabaseSync } from "node:sqlite";
import { initializeSchema } from "../../../platform/persistence/sqlite/schema-migrations";
import { SqliteService } from "../../../platform/persistence/sqlite/sqlite.service";
import { Book } from "../catalog/domain/book";
import { SqliteBookRepository } from "../catalog/infrastructure/persistence/sqlite/sqlite-book.repository";
import { SqliteCatalogBookDeletionRepository } from "../catalog/infrastructure/persistence/sqlite/sqlite-catalog-book-deletion.repository";
import { BookAnalysisRepository } from "../book-analysis/infrastructure/book-analysis.repository";
import { BookReadingProfileCandidate } from "../book-analysis/domain/book-reading-profile-candidate";
import { BookAnalysisTask } from "../book-analysis/domain/book-analysis-task";
import { SqliteDownloadTaskRepository } from "../../acquisition/download/infrastructure/sqlite-download-task.repository";
import { SqliteLibraryReadModelQuery } from "../library-queries/infrastructure/sqlite-library-read-model.query";
import { LibrarySyncState } from "./library-sync-state";
const now = "2026-09-23T00:00:00.000Z";
const revision = {
  fileChecksum: "checksum",
  extractorVersion: "v1",
  normalizationVersion: "v1",
};
describe("Committed library projection notifications", () => {
  let db: DatabaseSync,
    sqlite: SqliteService,
    sync: LibrarySyncState,
    books: SqliteBookRepository,
    id: number;
  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys=ON");
    initializeSchema(db);
    db.prepare(
      "INSERT INTO users(id,email,password_hash,created_at,updated_at) VALUES(1,'test@example.test','x',?,?)",
    ).run(now, now);
    sqlite = { getDatabase: () => db } as SqliteService;
    sync = new LibrarySyncState();
    books = new SqliteBookRepository(sqlite, sync);
    id = books.insert(
      Book.create({
        ownerId: 1,
        metadata: { title: "Book", authors: ["Author"] },
        now,
      }),
    );
  });
  afterEach(() => {
    sync.onModuleDestroy();
    db.close();
  });
  it("Catalog metadata/profile and actual deletion advance the user's version", () => {
    expect(sync.version(1).revision).toBe(1);
    const book = books.findById(1, id)!;
    book.editMetadata({ title: "Changed" }, now);
    books.save(book, 1);
    expect(sync.version(1).revision).toBe(2);
    book.editReadingProfile({ primaryGenre: "technical" }, now);
    books.save(book, 2);
    expect(sync.version(1).revision).toBe(3);
    const deletion = new SqliteCatalogBookDeletionRepository(sqlite, sync);
    deletion.deleteOne(1, id, now, now);
    expect(sync.version(1).revision).toBe(4);
    deletion.deleteOne(1, id, now, now);
    expect(sync.version(1).revision).toBe(4);
  });
  it("candidate consumption and nested Catalog save publish only after the outer commit, never rollback", () => {
    const analyses = new BookAnalysisRepository(sqlite, sync);
    analyses.saveProfile(
      BookReadingProfileCandidate.create({
        id: "candidate",
        userId: 1,
        bookId: id,
        primaryGenre: "technical",
        secondaryGenres: [],
        traits: [],
        confidence: 0.8,
        classificationSummary: "Summary",
        contentRevision: revision,
        modelId: "fake",
        strategyVersion: "v1",
        analyzedAt: now,
      }),
      1,
    );
    const before = sync.version(1).revision;
    const apply = () => {
      const book = books.findById(1, id)!;
      book.editReadingProfile({ primaryGenre: "technical" }, now);
      books.save(book, 1);
      expect(sync.version(1).revision).toBe(before);
    };
    expect(() =>
      analyses.consumeCandidate("candidate", () => {
        apply();
        throw Error("failure after Catalog save");
      }),
    ).toThrow("failure after Catalog save");
    expect(sync.version(1).revision).toBe(before);
    expect(books.findById(1, id)!.readingProfile.primaryGenre).toBeNull();
    analyses.consumeCandidate("candidate", apply);
    expect(sync.version(1).revision).toBe(before + 1);
  });
  it("analysis enqueue/claim/failure notify but lease resume does not", () => {
    const analyses = new BookAnalysisRepository(sqlite, sync);
    const before = sync.version(1).revision;
    analyses.enqueueIfAbsent(
      BookAnalysisTask.create({
        id: "task",
        userId: 1,
        bookId: id,
        contentRevision: revision,
        modelId: "fake",
        strategyVersion: "v1",
        requestedAt: now,
      }),
    );
    expect(sync.version(1).revision).toBe(before + 1);
    const claimed = analyses.claimNext("worker", now, 1000)!;
    expect(sync.version(1).revision).toBe(before + 2);
    const resumed = analyses.claimNext(
      "worker2",
      "2026-09-23T00:00:02.000Z",
      1000,
    )!;
    expect(sync.version(1).revision).toBe(before + 2);
    expect(
      analyses.fail({
        taskId: "task",
        lease: claimed.lease,
        errorCode: "failed",
        now,
      }),
    ).toBe(false);
    analyses.fail({
      taskId: "task",
      lease: resumed.lease,
      errorCode: "failed",
      now,
    });
    expect(sync.version(1).revision).toBe(before + 3);
  });
  it("download percentage only advances progress watermarks; status transitions invalidate and list includes task identity", () => {
    const downloads = new SqliteDownloadTaskRepository(sqlite, sync);
    const task = downloads.createTask({
      userId: 1,
      bookId: id,
      sourcePlatform: "zlibrary",
      sourceUrl: "https://example.test",
      requestedFileName: null,
      hash: "hash",
      sourceBookId: "source",
    });
    downloads.markDownloading(task.id);
    const before = sync.version(1).revision;
    downloads.updateProgress(task.id, 12.1);
    downloads.updateProgress(task.id, 12.4);
    expect(sync.version(1).revision).toBe(before);
    expect(sync.watermark(1)).toBe(1);
    const page = new SqliteLibraryReadModelQuery(sqlite).listBooks({
      userId: 1,
      page: 1,
      pageSize: 20,
    });
    expect(page.items[0]).toMatchObject({
      downloadTaskId: task.id,
      downloadProgress: 12,
    });
    downloads.markFailed(task.id, "failure");
    expect(sync.version(1).revision).toBe(before + 1);
    downloads.updateProgress(task.id, 90);
    expect(sync.watermark(1)).toBe(1);
  });
  it("same timestamp pagination has a deterministic id tie-breaker", () => {
    const second = books.insert(
      Book.create({
        ownerId: 1,
        metadata: { title: "Second", authors: ["Author"] },
        now,
      }),
    );
    const query = new SqliteLibraryReadModelQuery(sqlite);
    expect(
      query.listBooks({ userId: 1, page: 1, pageSize: 1 }).items[0].id,
    ).toBe(second);
    expect(
      query.listBooks({ userId: 1, page: 2, pageSize: 1 }).items[0].id,
    ).toBe(id);
  });
});
