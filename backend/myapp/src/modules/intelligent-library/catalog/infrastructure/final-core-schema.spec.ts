import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { SqliteService } from "../../../../platform/persistence/sqlite/sqlite.service";

describe("final core library schema", () => {
  let root: string;
  let sqlite: SqliteService;
  let previousPath: string | undefined;

  beforeEach(() => {
    previousPath = process.env.SQLITE_PATH;
    root = mkdtempSync(resolve(tmpdir(), "final-core-schema-"));
    process.env.SQLITE_PATH = resolve(root, "final.sqlite");
    sqlite = new SqliteService();
    sqlite.onModuleInit();
  });

  afterEach(() => {
    sqlite.onApplicationShutdown();
    rmSync(root, { recursive: true, force: true });
    if (previousPath === undefined) delete process.env.SQLITE_PATH;
    else process.env.SQLITE_PATH = previousPath;
  });

  it("uses source_refs as the only source fact and enforces tenant closure", () => {
    const database = sqlite.getDatabase();
    const bookColumns = columns(database, "books");
    expect(bookColumns).not.toEqual(expect.arrayContaining([
      "source_platform", "source_book_id", "source_url",
    ]));
    expect(columns(database, "source_refs")).toEqual(expect.arrayContaining([
      "format", "hash", "is_primary",
    ]));

    const foreignKeys = database.prepare("PRAGMA foreign_key_list(source_refs)").all() as unknown as Array<{
      id: number; seq: number; from: string; to: string; table: string;
    }>;
    const bookForeignKey = foreignKeys
      .filter((row) => row.table === "books")
      .sort((left, right) => left.seq - right.seq);
    expect(bookForeignKey.map((row) => [row.from, row.to])).toEqual([
      ["book_id", "id"],
      ["user_id", "user_id"],
    ]);

    const indexes = database.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as unknown as Array<{ name: string }>;
    expect(indexes.map((row) => row.name)).toContain("uq_source_refs_primary_book");
    expect(indexes.map((row) => row.name)).not.toContain("idx_books_user_source");
  });

  it("uses a minimal current artifact pointer and Douban-specific rating table", () => {
    const database = sqlite.getDatabase();
    expect(tableExists(database, "book_files")).toBe(false);
    expect(columns(database, "book_current_artifacts")).toEqual([
      "book_id", "artifact_id", "activated_at",
    ]);
    expect(tableExists(database, "book_external_ratings")).toBe(false);
    expect(tableExists(database, "book_douban_ratings")).toBe(true);
  });

  it("rejects pointers to inactive or another Book artifact and protects current artifacts", () => {
    const database = sqlite.getDatabase();
    const now = "2026-08-31T00:00:00.000Z";
    database.prepare(`
      INSERT INTO users (id, email, password_hash, created_at, updated_at)
      VALUES (1, 'owner@example.test', 'hash', ?, ?)
    `).run(now, now);
    for (const id of [10, 11]) {
      database.prepare(`
        INSERT INTO books (
          id, user_id, title, title_normalized, authors_json, authors_text,
          version, created_at, updated_at
        ) VALUES (?, 1, ?, ?, '[]', '', 1, ?, ?)
      `).run(id, `Book ${id}`, `book ${id}`, now, now);
    }
    const insertArtifact = database.prepare(`
      INSERT INTO book_artifacts (
        artifact_id, delivery_id, user_id, book_id, status, stored_path,
        file_name, mime_type, file_size, checksum, managed, created_at, updated_at
      ) VALUES (?, ?, 1, ?, ?, ?, ?, 'application/pdf', 10, ?, 1, ?, ?)
    `);
    insertArtifact.run("inactive", "delivery-inactive", 10, "ready", "inactive.pdf", "inactive.pdf", "checksum-inactive", now, now);
    insertArtifact.run("other-book", "delivery-other", 11, "active", "other.pdf", "other.pdf", "checksum-other", now, now);
    insertArtifact.run("current", "delivery-current", 10, "active", "current.pdf", "current.pdf", "checksum-current", now, now);

    expect(() => database.prepare(`
      INSERT INTO book_current_artifacts (book_id, artifact_id, activated_at)
      VALUES (10, 'inactive', ?)
    `).run(now)).toThrow();
    expect(() => database.prepare(`
      INSERT INTO book_current_artifacts (book_id, artifact_id, activated_at)
      VALUES (10, 'other-book', ?)
    `).run(now)).toThrow();

    database.prepare(`
      INSERT INTO book_current_artifacts (book_id, artifact_id, activated_at)
      VALUES (10, 'current', ?)
    `).run(now);
    expect(() => database.prepare(
      "UPDATE book_artifacts SET status='retired' WHERE artifact_id='current'",
    ).run()).toThrow();
  });

  it("contains no core runtime compatibility helpers", () => {
    const source = readFileSync(resolve(
      process.cwd(), "src/platform/persistence/sqlite/sqlite.service.ts",
    ), "utf8");
    for (const forbidden of [
      "ensureBookProfiles",
      "ensureBookArtifactLedger",
      "migrateBookFilesToCanonicalSchema",
      "ensureBookFilesChecksumUniqueIndex",
      'ensureColumn("book_files"',
      'ensureColumn("source_refs", "hash"',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});

function columns(database: ReturnType<SqliteService["getDatabase"]>, table: string): string[] {
  return (database.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>)
    .map((row) => row.name);
}

function tableExists(database: ReturnType<SqliteService["getDatabase"]>, table: string): boolean {
  return Boolean(database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
  ).get(table));
}
