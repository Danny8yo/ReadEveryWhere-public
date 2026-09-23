import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { SqliteService } from "../../../../platform/persistence/sqlite/sqlite.service";

describe("identity and download task schema invariants", () => {
  let root: string;
  let sqlite: SqliteService;
  let previousPath: string | undefined;

  beforeEach(() => {
    previousPath = process.env.SQLITE_PATH;
    root = mkdtempSync(resolve(tmpdir(), "download-schema-"));
    process.env.SQLITE_PATH = resolve(root, "schema.sqlite");
    sqlite = new SqliteService();
    sqlite.onModuleInit();
  });

  afterEach(() => {
    sqlite.onApplicationShutdown();
    rmSync(root, { recursive: true, force: true });
    if (previousPath === undefined) delete process.env.SQLITE_PATH;
    else process.env.SQLITE_PATH = previousPath;
  });

  it("rejects email values that are not trimmed lowercase canonical form", () => {
    const database = sqlite.getDatabase();
    expect(() => database.prepare(`
      INSERT INTO users (email, password_hash, created_at, updated_at)
      VALUES (' Mixed@Example.COM ', 'hash', 'now', 'now')
    `).run()).toThrow();
  });

  it("rejects a download task whose user does not own the referenced Book", () => {
    const database = sqlite.getDatabase();
    insertUser(database, 1, "first@example.com");
    insertUser(database, 2, "second@example.com");
    insertBook(database, 10, 2);

    expect(() => insertTask(database, 1, 10, "queued")).toThrow();
  });

  it("allows at most one active download task for one user and Book", () => {
    const database = sqlite.getDatabase();
    insertUser(database, 1, "owner@example.com");
    insertBook(database, 10, 1);
    insertTask(database, 1, 10, "queued");

    expect(() => insertTask(database, 1, 10, "downloading")).toThrow();
    expect(() => insertTask(database, 1, 10, "failed")).not.toThrow();
  });
});

function insertUser(database: ReturnType<SqliteService["getDatabase"]>, id: number, email: string) {
  database.prepare(`
    INSERT INTO users (id, email, password_hash, created_at, updated_at)
    VALUES (?, ?, 'hash', 'now', 'now')
  `).run(id, email);
}

function insertBook(database: ReturnType<SqliteService["getDatabase"]>, id: number, userId: number) {
  database.prepare(`
    INSERT INTO books (
      id, user_id, title, title_normalized, authors_json, authors_text,
      version, created_at, updated_at
    ) VALUES (?, ?, 'Book', 'book', '[]', '', 1, 'now', 'now')
  `).run(id, userId);
}

function insertTask(
  database: ReturnType<SqliteService["getDatabase"]>,
  userId: number,
  bookId: number,
  status: "queued" | "downloading" | "failed",
) {
  database.prepare(`
    INSERT INTO download_tasks (
      user_id, book_id, source_platform, source_url, delivery_id,
      phase, status, progress, created_at, updated_at
    ) VALUES (?, ?, 'zlibrary', 'zlibrary:fixture', ?, ?, ?, 0, 'now', 'now')
  `).run(userId, bookId, `${userId}-${bookId}-${status}-${Math.random()}`, status, status);
}
