import { LibrarySyncState } from "../../library-sync/library-sync-state";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteService } from "../../../../platform/persistence/sqlite/sqlite.service";
import { StorageService } from "../../../../platform/storage/storage.service";
import { CatalogAcquisitionAdapter } from "./catalog-acquisition.adapter";
import { SqliteBookRepository } from "./persistence/sqlite/sqlite-book.repository";
import { SqliteBookArtifactRepository } from "./persistence/sqlite/sqlite-book-artifact.repository";
import { StorageBookArtifactAdapter } from "./storage-book-artifact.adapter";
import { AttachBookFileUseCase } from "../application/use-cases/attach-book-file.use-case";
import { DetachBookFileUseCase } from "../application/use-cases/detach-book-file.use-case";
import type { AttachedBookFileProjection } from "../../public/book-file-acquisition.port";
import type { PdfPageTreeOptimizerPort } from "../application/ports/pdf-page-tree-optimizer.port";
import { readFileSync } from "node:fs";
import AdmZip from "adm-zip";

// AttachBookFileUseCase 现在会在 PDF 落库前调用页树重建。这些用例不关心重建本身，
// 桩件只把磁盘上文件的真实大小报回去，保持落库事实自洽。
const stubPdfPageTrees: PdfPageTreeOptimizerPort = {
  optimize: async (absolutePath: string) => ({
    optimized: false,
    fileSize: readFileSync(absolutePath).byteLength,
    skipReason: "stubbed in tests",
  }),
};

function minimalEpub(): Buffer {
  const zip = new AdmZip();
  zip.addFile("mimetype", Buffer.from("application/epub+zip"));
  return zip.toBuffer();
}

describe("CatalogAcquisitionAdapter file compensation", () => {
  let root: string;
  let sqlite: SqliteService;
  let adapter: CatalogAcquisitionAdapter;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "rew-catalog-acquisition-"));
    process.env.SQLITE_PATH = join(root, "test.sqlite");
    process.env.DOWNLOAD_STORAGE_PATH = join(root, "downloads");
    sqlite = new SqliteService();
    sqlite.onModuleInit();
    const storage = new StorageService();
    const artifacts = new StorageBookArtifactAdapter(storage);
    const files = new SqliteBookArtifactRepository(sqlite, new SqliteBookRepository(sqlite, new LibrarySyncState()), new LibrarySyncState());
    adapter = new CatalogAcquisitionAdapter(
      sqlite,
      storage,
      new AttachBookFileUseCase(new SqliteBookRepository(sqlite, new LibrarySyncState()), files, artifacts, stubPdfPageTrees),
      new DetachBookFileUseCase(files, artifacts),
    );
    seedUserAndBook(sqlite);
  });

  afterEach(() => {
    sqlite.onApplicationShutdown();
    rmSync(root, { recursive: true, force: true });
    delete process.env.SQLITE_PATH;
    delete process.env.DOWNLOAD_STORAGE_PATH;
  });

  it("deletes the matching current pointer and retires the artifact", async () => {
    const delivered = await seedAttachedFile("matching.epub", "checksum-matching");
    adapter.detach({
      userId: 7,
      bookId: 42,
      localPath: delivered.localPath,
      checksum: "checksum-matching",
    });

    expect(bookFileCount()).toBe(0);
    expect(existsSync(delivered.localPath)).toBe(true);
    expect(sqlite.getDatabase().prepare(
      "SELECT status FROM book_artifacts WHERE artifact_id = ?",
    ).get(delivered.artifactId)).toEqual({ status: "retired" });
  });

  it("preserves both row and artifact when the compensation identity does not match", async () => {
    const delivered = await seedAttachedFile("current.epub", "checksum-current");
    adapter.detach({
      userId: 7,
      bookId: 42,
      localPath: delivered.localPath,
      checksum: "checksum-stale-task",
    });

    expect(bookFileCount()).toBe(1);
    expect(existsSync(delivered.localPath)).toBe(true);
  });

  it("rejects downloaded bytes that are not an ebook", async () => {
    await expect(adapter.attach({
      userId: 7,
      bookId: 42,
      sourcePlatform: "zlibrary",
      sourceUrl: "/download/42",
      content: Buffer.from("<html><script>alert(1)</script></html>"),
      fileName: "book.epub",
      mimeType: "text/html",
      fileSize: 38,
      checksum: "checksum-html",
    })).rejects.toThrow("下载的文件不是有效的 EPUB、PDF、MOBI 或 AZW3");
    expect(bookFileCount()).toBe(0);
  });

  it("stores the detected MIME instead of the upstream Content-Type", async () => {
    const content = minimalEpub();
    const delivered = await adapter.attach({
      userId: 7,
      bookId: 42,
      sourcePlatform: "zlibrary",
      sourceUrl: "/download/42",
      content,
      fileName: "book.epub",
      mimeType: "text/html",
      fileSize: content.byteLength,
      checksum: "checksum-mislabelled",
    });
    expect(sqlite.getDatabase().prepare(
      "SELECT mime_type FROM book_artifacts WHERE artifact_id = ?",
    ).get(delivered.artifactId)).toEqual({ mime_type: "application/epub+zip" });
  });

  function seedAttachedFile(fileName: string, checksum: string): Promise<AttachedBookFileProjection> {
    const artifact = join(root, "downloads", "7", fileName);
    mkdirSync(join(root, "downloads", "7"), { recursive: true });
    writeFileSync(artifact, minimalEpub());
    return adapter.attach({
      userId: 7,
      bookId: 42,
      sourcePlatform: "zlibrary",
      sourceUrl: "/download/42",
      localPath: artifact,
      fileName,
      mimeType: "application/epub+zip",
      fileSize: 7,
      checksum,
    });
  }

  function bookFileCount(): number {
    const row = sqlite.getDatabase().prepare(
      "SELECT COUNT(*) AS total FROM book_current_artifacts WHERE book_id = ?",
    ).get(42) as { total: number };
    return Number(row.total);
  }
});

function seedUserAndBook(sqlite: SqliteService): void {
  const now = "2026-08-26T00:00:00.000Z";
  const database = sqlite.getDatabase();
  database.prepare(
    "INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(7, "catalog-acquisition@example.com", "hash", now, now);
  database.prepare(`
    INSERT INTO books (
      id, user_id, title, title_normalized, authors_json, authors_text,
      version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(42, 7, "Book", "book", "[]", "", 1, now, now);
}
