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
import { BookArtifact } from "../catalog/domain/book-artifact";
import { SqliteBookArtifactRepository } from "../catalog/infrastructure/persistence/sqlite/sqlite-book-artifact.repository";
import { LibrarySyncState } from "./library-sync-state";
const now = "2026-09-23T00:00:00.000Z";
const revision = {
  fileChecksum: "checksum",
  extractorVersion: "v1",
  normalizationVersion: "v1",
};
// 编号对应 doc/同步测试用例审查.md
describe("哪些书架变化会通知其他设备（提交后才通知）", () => {
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
  it("B4 修改元数据、修改阅读画像、删除书都会通知；删除已删除的书不重复通知", () => {
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
  it("B5 应用 AI 分析结果中途失败回滚 → 书不变且不通知；成功提交后才通知", () => {
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
  it("B6 AI 分析排队、开始、失败会通知；被另一进程接手不通知；超时进程迟到的失败报告被拒绝", () => {
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
  it("B7 下载百分比只推进度不算书架变化；列表带任务号和取整进度；下载失败算书架变化；失败后的迟到进度被忽略", () => {
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
  it("N8 导入新书（写入书籍）会通知", () => {
    const before = sync.version(1).revision;
    books.insert(
      Book.create({
        ownerId: 1,
        metadata: { title: "Imported", authors: ["Author"] },
        now,
      }),
    );
    expect(sync.version(1).revision).toBe(before + 1);
  });
  it("N8 给书添加来源会通知", () => {
    const before = sync.version(1).revision;
    const book = books.findById(1, id)!;
    book.addSourceReference(
      { platform: "zlibrary", sourceBookId: "z-1", sourceUrl: "https://example.test/z-1" },
      now,
    );
    expect(books.save(book, 1)).toBe("saved");
    expect(sync.version(1).revision).toBe(before + 1);
  });
  it("N8 电子书文件激活（含替换）和撤销都会通知", () => {
    const artifacts = new SqliteBookArtifactRepository(sqlite, books, sync);
    const activate = (artifactId: string, checksum: string) => {
      const artifact = BookArtifact.reserve({
        artifactId,
        deliveryId: `delivery-${artifactId}`,
        ownerId: 1,
        bookId: id,
        storedPath: `1/artifacts/${artifactId}.epub`,
        stagingStoredPath: `1/artifacts/.staging/${artifactId}.part`,
        sourcePlatform: "zlibrary",
        sourceUrl: "https://example.test/book",
        managed: true,
        now,
      });
      artifacts.reserve(artifact);
      artifact.markReady(
        { fileName: `${artifactId}.epub`, mimeType: "application/epub+zip", fileSize: 42, checksum },
        now,
      );
      artifact.activate(now);
      artifacts.activate(artifact, now);
      return artifact;
    };
    const before = sync.version(1).revision;
    activate("first", "checksum-1");
    expect(sync.version(1).revision).toBe(before + 1);
    const replacement = activate("second", "checksum-2");
    expect(sync.version(1).revision).toBe(before + 2);
    expect(
      artifacts.retireCurrentExact(
        { ownerId: 1, bookId: id, checksum: "checksum-2", storedPath: replacement.snapshot.storedPath },
        now,
        now,
      ),
    ).toBe(true);
    expect(sync.version(1).revision).toBe(before + 3);
  });
  it("N8 下载任务创建、完成、取消都会通知", () => {
    const downloads = new SqliteDownloadTaskRepository(sqlite, sync);
    const create = (hash: string) =>
      downloads.createTask({
        userId: 1,
        bookId: id,
        sourcePlatform: "zlibrary",
        sourceUrl: "https://example.test",
        requestedFileName: null,
        hash,
        sourceBookId: hash,
      });
    const before = sync.version(1).revision;
    const completed = create("completed");
    expect(sync.version(1).revision).toBe(before + 1);
    downloads.markCompleted(completed.id, "1/completed.epub");
    expect(sync.version(1).revision).toBe(before + 2);
    const canceled = create("canceled");
    expect(sync.version(1).revision).toBe(before + 3);
    expect(downloads.cancelTask(1, canceled.id)).toBe(true);
    expect(sync.version(1).revision).toBe(before + 4);
  });
});
