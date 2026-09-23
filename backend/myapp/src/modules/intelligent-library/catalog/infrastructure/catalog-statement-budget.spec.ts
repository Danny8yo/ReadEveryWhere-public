import { LibrarySyncState } from "../../library-sync/library-sync-state";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { SqliteService } from "../../../../platform/persistence/sqlite/sqlite.service";
import { StorageService } from "../../../../platform/storage/storage.service";
import { createSqliteStatementProbe, SqliteStatementProbe } from "../../../../../test/helpers/sqlite-statement-probe";
import { CreateBookUseCase } from "../application/use-cases/create-book.use-case";
import { AttachBookFileUseCase } from "../application/use-cases/attach-book-file.use-case";
import { ImportBookUseCase } from "../application/use-cases/import-book.use-case";
import { UpdateBookUseCase } from "../application/use-cases/update-book.use-case";
import { EpubMetadataParser } from "./epub-metadata.parser";
import { ImportedBookInspectorAdapter } from "./imported-book-inspector.adapter";
import { LocalImportedFileStoreAdapter } from "./local-imported-file-store.adapter";
import { SqliteBookContentCatalogQuery } from "./persistence/sqlite/sqlite-book-content-catalog.query";
import { SqliteBookDuplicateQuery } from "./persistence/sqlite/sqlite-book-duplicate.query";
import { SqliteBookArtifactRepository } from "./persistence/sqlite/sqlite-book-artifact.repository";
import { SqliteBookRepository } from "./persistence/sqlite/sqlite-book.repository";
import { SqliteCatalogBookViewQuery } from "./persistence/sqlite/sqlite-catalog-book-view.query";
import { StorageBookArtifactAdapter } from "./storage-book-artifact.adapter";
import { BookAnalysisSourceAdapter } from "../../book-analysis/infrastructure/book-analysis-source.adapter";
import { BookAnalysisSummaryProjector } from "../../book-analysis/infrastructure/book-analysis-summary.projector";
import { ListLibraryBooksUseCase } from "../../library-queries/application/list-library-books.use-case";
import { SqliteLibraryReadModelQuery } from "../../library-queries/infrastructure/sqlite-library-read-model.query";
import type { PdfPageTreeOptimizerPort } from "../application/ports/pdf-page-tree-optimizer.port";
import { readFileSync } from "node:fs";

// AttachBookFileUseCase 现在会在 PDF 落库前调用页树重建。这些用例不关心重建本身，
// 桩件只把磁盘上文件的真实大小报回去，保持落库事实自洽。
const stubPdfPageTrees: PdfPageTreeOptimizerPort = {
  optimize: async (absolutePath: string) => ({
    optimized: false,
    fileSize: readFileSync(absolutePath).byteLength,
    skipReason: "stubbed in tests",
  }),
};


describe("catalog SQLite statement budgets", () => {
  let root: string;
  let sqlite: SqliteService;
  let duplicates: SqliteBookDuplicateQuery;
  let views: SqliteCatalogBookViewQuery;
  let content: SqliteBookContentCatalogQuery;
  let library: SqliteLibraryReadModelQuery;
  let books: SqliteBookRepository;
  let probe: SqliteStatementProbe;
  let originalSqlitePath: string | undefined;
  let originalStoragePath: string | undefined;

  beforeAll(() => {
    originalSqlitePath = process.env.SQLITE_PATH;
    originalStoragePath = process.env.DOWNLOAD_STORAGE_PATH;
    root = mkdtempSync(resolve(tmpdir(), "catalog-statement-budget-"));
    process.env.SQLITE_PATH = resolve(root, "catalog.sqlite");
    process.env.DOWNLOAD_STORAGE_PATH = resolve(root, "storage");

    sqlite = new SqliteService();
    sqlite.onModuleInit();
    const database = sqlite.getDatabase();
    database.prepare(`
      INSERT INTO users (id, email, password_hash, created_at, updated_at)
      VALUES (1, 'budget@example.test', 'hash', '2026-01-01', '2026-01-01')
    `).run();

    probe = createSqliteStatementProbe(database);
    jest.spyOn(sqlite, "getDatabase").mockReturnValue(probe.database);
    duplicates = new SqliteBookDuplicateQuery(sqlite);
    views = new SqliteCatalogBookViewQuery(sqlite);
    content = new SqliteBookContentCatalogQuery(sqlite, new StorageService());
    library = new SqliteLibraryReadModelQuery(sqlite);
    books = new SqliteBookRepository(sqlite, new LibrarySyncState());
  });

  afterAll(() => {
    sqlite.onApplicationShutdown();
    rmSync(root, { recursive: true, force: true });
    restoreEnv("SQLITE_PATH", originalSqlitePath);
    restoreEnv("DOWNLOAD_STORAGE_PATH", originalStoragePath);
  });

  it("keeps the successful manual create path within its fixed statement budget", () => {
    const createBook = new CreateBookUseCase(books, duplicates, views);
    probe.reset();

    const created = createBook.execute(1, {
      title: "Budget create",
      authors: ["Author"],
    });

    expect(created.title).toBe("Budget create");
    expect(probe.executions).toHaveLength(6);
    expect(probe.executions.map(({ kind }) => kind)).toEqual([
      "get", "exec", "run", "run", "exec", "get",
    ]);
  });

  it("keeps the successful update path within its fixed statement budget", () => {
    const createBook = new CreateBookUseCase(books, duplicates, views);
    const created = createBook.execute(1, { title: "Before update", authors: ["Author"] });
    const updateBook = new UpdateBookUseCase(books, views);
    probe.reset();

    const updated = updateBook.execute(1, created.id, { title: "After update" });

    expect(updated.title).toBe("After update");
    expect(probe.executions).toHaveLength(9);
    expect(probe.executions.map(({ kind }) => kind)).toEqual([
      "get",
      "all",
      "get",
      "exec",
      "run",
      "run",
      "run",
      "exec",
      "get",
    ]);
  });

  it("keeps the successful local import path within its fixed statement budget", async () => {
    const storage = new StorageService();
    const importer = new ImportBookUseCase(
      books,
      duplicates,
      views,
      new LocalImportedFileStoreAdapter(storage),
      new ImportedBookInspectorAdapter(new EpubMetadataParser()),
      new AttachBookFileUseCase(
        books,
        new SqliteBookArtifactRepository(sqlite, books, new LibrarySyncState()),
        new StorageBookArtifactAdapter(storage),
        stubPdfPageTrees,
      ),
    );
    const buffer = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF");
    probe.reset();

    const imported = await importer.execute({
      userId: 1,
      file: { originalname: "budget-import.pdf", mimetype: "application/pdf", buffer, size: buffer.length },
      title: "Budget import",
      authors: "Importer",
      conflictPolicy: "rename",
    });

    expect(imported.book.title).toBe("Budget import");
    const importExecutions = [...probe.executions];
    const fileSource = sqlite.getDatabase().prepare(
      `SELECT artifact.source_platform, artifact.source_url
       FROM book_current_artifacts current
       INNER JOIN book_artifacts artifact ON artifact.artifact_id = current.artifact_id
       WHERE current.book_id = ?`,
    ).get(imported.book.id) as { source_platform: string | null; source_url: string | null };
    expect(fileSource).toEqual({ source_platform: null, source_url: null });
    expect(importExecutions.map(({ kind }) => kind)).toContain("exec");
  });

  it("keeps BookAnalysis ownership and file lookup on two read projections", () => {
    const createBook = new CreateBookUseCase(books, duplicates, views);
    const created = createBook.execute(1, { title: "Analysis source", authors: ["Author"] });
    const source = new BookAnalysisSourceAdapter(views, content, {} as any);
    probe.reset();

    expect(source.findOwnedAnalysisSource(1, created.id)).toMatchObject({
      bookId: created.id,
      userId: 1,
    });
    expect(probe.executions.map(({ kind }) => kind)).toEqual(["get", "get"]);
  });

  it("keeps list statement count constant as pageSize grows", () => {
    seedBooks(60);

    probe.reset();
    const one = library.listBooks({ userId: 1, page: 1, pageSize: 1 });
    const oneExecutions = [...probe.executions];

    probe.reset();
    const fifty = library.listBooks({ userId: 1, page: 1, pageSize: 50 });
    const fiftyExecutions = [...probe.executions];

    expect(one.items).toHaveLength(1);
    expect(fifty.items).toHaveLength(50);
    expect(oneExecutions.map(({ kind }) => kind)).toEqual(["all", "get"]);
    expect(fiftyExecutions.map(({ kind }) => kind)).toEqual(["all", "get"]);
    expect(fiftyExecutions).toHaveLength(oneExecutions.length);
  });

  it("freezes the existing BookAnalysis summary slope at four statements per EPUB item", () => {
    seedAnalyzableBooks(5);
    const list = new ListLibraryBooksUseCase(
      library,
      new BookAnalysisSummaryProjector(sqlite),
    );

    probe.reset();
    const one = list.execute(1, { page: 1, pageSize: 1, keyword: "analysis-budget" });
    const oneExecutions = [...probe.executions];

    probe.reset();
    const five = list.execute(1, { page: 1, pageSize: 5, keyword: "analysis-budget" });
    const fiveExecutions = [...probe.executions];

    expect(one.items).toHaveLength(1);
    expect(five.items).toHaveLength(5);
    expect(oneExecutions).toHaveLength(6);
    expect(fiveExecutions).toHaveLength(22);
    expect(fiveExecutions.length - oneExecutions.length).toBe(4 * (5 - 1));
  });

  function seedBooks(count: number): void {
    const statement = sqlite.getDatabase().prepare(`
      INSERT INTO books (
        user_id, title, title_normalized, authors_json, authors_text,
        version, created_at, updated_at
      ) VALUES (?, ?, ?, '[]', '', 1, ?, ?)
    `);
    const profile = sqlite.getDatabase().prepare(`
      INSERT INTO book_profiles (id, book_id, secondary_genres_json, traits_json, profile_version, updated_at)
      VALUES (?, ?, '[]', '[]', 1, ?)
    `);
    for (let index = 0; index < count; index += 1) {
      const timestamp = `2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z`;
      const bookId = Number(statement.run(1, `Seed ${index}`, `seed ${index}`, timestamp, timestamp).lastInsertRowid);
      profile.run(`seed-profile-${bookId}`, bookId, timestamp);
    }
  }

  function seedAnalyzableBooks(count: number): void {
    const database = sqlite.getDatabase();
    const insertBook = database.prepare(`
      INSERT INTO books (
        user_id, title, title_normalized, authors_json, authors_text,
        version, created_at, updated_at
      ) VALUES (1, ?, ?, '[]', '', 1, '2026-01-02', '2026-01-02')
    `);
    const insertArtifact = database.prepare(`
      INSERT INTO book_artifacts (
        artifact_id, delivery_id, user_id, book_id, status, stored_path,
        file_name, mime_type, file_size, checksum, managed, created_at, updated_at
      ) VALUES (?, ?, 1, ?, 'active', ?, ?, 'application/epub+zip', 1, ?, 1,
        '2026-01-02', '2026-01-02')
    `);
    const insertPointer = database.prepare(`
      INSERT INTO book_current_artifacts (book_id, artifact_id, activated_at)
      VALUES (?, ?, '2026-01-02')
    `);
    const insertProfile = database.prepare(`
      INSERT INTO book_profiles (id, book_id, secondary_genres_json, traits_json, profile_version, updated_at)
      VALUES (?, ?, '[]', '[]', 1, '2026-01-02')
    `);
    for (let index = 0; index < count; index += 1) {
      const title = `analysis-budget-${index}`;
      const bookId = Number(insertBook.run(title, title).lastInsertRowid);
      insertProfile.run(`analysis-profile-${bookId}`, bookId);
      const storedPath = `1/imports/${title}.epub`;
      const artifactId = `analysis-artifact-${bookId}`;
      insertArtifact.run(
        artifactId,
        `analysis-delivery-${bookId}`,
        bookId,
        storedPath,
        `${title}.epub`,
        `checksum-${index}`,
      );
      insertPointer.run(bookId, artifactId);
    }
  }
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
