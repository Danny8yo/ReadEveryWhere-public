import { LibrarySyncState } from "../../../../library-sync/library-sync-state";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteService } from "../../../../../../platform/persistence/sqlite/sqlite.service";
import { Book } from "../../../domain/book";
import { SqliteBookRepository } from "./sqlite-book.repository";

describe("SqliteBookRepository", () => {
  let directory: string;
  let databasePath: string;
  let firstService: SqliteService;
  let secondService: SqliteService;
  let first: SqliteBookRepository;
  let second: SqliteBookRepository;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "rew-book-repo-"));
    databasePath = join(directory, "catalog.sqlite");
    process.env.SQLITE_PATH = databasePath;
    firstService = new SqliteService();
    firstService.onModuleInit();
    firstService.getDatabase().prepare(`
      INSERT INTO users (email, password_hash, created_at, updated_at)
      VALUES ('owner@example.test', 'hash', '2026-08-26T00:00:00.000Z', '2026-08-26T00:00:00.000Z')
    `).run();
    secondService = new SqliteService();
    first = new SqliteBookRepository(firstService, new LibrarySyncState());
    second = new SqliteBookRepository(secondService, new LibrarySyncState());
  });

  afterEach(() => {
    firstService.getDatabase().close();
    secondService.getDatabase().close();
    rmSync(directory, { recursive: true, force: true });
    delete process.env.SQLITE_PATH;
  });

  it("atomically inserts books and their initial source reference", () => {
    const id = first.insert(newBook());

    const book = first.findById(1, id);
    expect(book).not.toBeNull();
    expect(book?.metadata).toMatchObject({ title: "Source Book", authors: ["Author"] });
    expect(book?.sourceReferences).toEqual([
      expect.objectContaining({
        platform: "zlibrary",
        sourceBookId: "source-1",
        hash: "hash-1",
      }),
    ]);
    const row = firstService.getDatabase().prepare(
      "SELECT source_platform, source_book_id, is_primary FROM source_refs WHERE book_id = ?",
    ).get(id) as Record<string, unknown>;
    expect(row).toEqual({ source_platform: "zlibrary", source_book_id: "source-1", is_primary: 1 });
  });

  it("为新书原子建立一条正式空画像，并在 save 时同步画像", () => {
    const id = first.insert(newBook());
    const row = firstService.getDatabase().prepare(
      "SELECT book_id, primary_genre, profile_version, traits_json FROM book_profiles WHERE book_id = ?",
    ).get(id);
    expect(row).toEqual({ book_id: id, primary_genre: null, profile_version: 1, traits_json: "[]" });

    const loaded = first.findById(1, id)!;
    expect(loaded.readingProfile.primaryGenre).toBeNull();
    loaded.editReadingProfile({ primaryGenre: "technical", classificationSummary: null }, "2026-08-27T01:00:00.000Z");
    expect(first.save(loaded, 1)).toBe("saved");
    expect(first.findById(1, id)?.readingProfile).toMatchObject({
      primaryGenre: "technical",
      confidence: { kind: "user-determined" },
      profileVersion: 2,
    });
  });

  it("Book CAS 冲突时不留下半提交的画像更新", () => {
    const id = first.insert(newBook());
    const loaded = first.findById(1, id)!;
    loaded.editReadingProfile({ primaryGenre: "technical" }, "2026-08-27T01:00:00.000Z");
    firstService.getDatabase().prepare("UPDATE books SET version = 2 WHERE id = ?").run(id);

    expect(first.save(loaded, 1)).toBe("conflict");
    expect(first.findById(1, id)?.readingProfile.primaryGenre).toBeNull();
  });

  it("拒绝损坏的 AI 置信度，而不是用 NaN 伪造画像", () => {
    const id = first.insert(newBook());
    firstService.getDatabase().prepare(`
      UPDATE book_profiles
      SET primary_genre = 'technical', confidence_kind = 'ai-score', confidence_score = NULL
      WHERE book_id = ?
    `).run(id);

    expect(() => first.findById(1, id))
      .toThrow("book_profiles.confidence_score is required for ai-score profiles");
  });

  it("缺失正式画像时 fail-fast，不在启动期静默补数据", () => {
    const corruptBookId = Number(firstService.getDatabase().prepare(`
      INSERT INTO books (user_id, title, title_normalized, authors_json, authors_text,
        version, created_at, updated_at)
      VALUES (1, 'Corrupt', 'corrupt', '[]', '', 1, ?, ?)
    `).run("2026-08-26", "2026-08-26").lastInsertRowid);

    expect(() => first.findById(1, corruptBookId))
      .toThrow("Book " + corruptBookId + " is missing its reading profile");
  });

  it("rejects a stale save across two SQLite connections", () => {
    const id = first.insert(newBook());
    const firstCopy = first.findById(1, id)!;
    const staleCopy = second.findById(1, id)!;

    firstCopy.editMetadata({ title: "User title" }, "2026-08-26T01:00:00.000Z");
    expect(first.save(firstCopy, 1)).toBe("saved");
    staleCopy.editMetadata({ title: "Stale enrichment" }, "2026-08-26T01:00:01.000Z");
    expect(second.save(staleCopy, 1)).toBe("conflict");

    const persisted = first.findById(1, id)!;
    expect(persisted.metadata.title).toBe("User title");
    expect(persisted.version).toBe(2);
  });

  it("saves an added primary source reference with the Book CAS", () => {
    const id = first.insert(manualBook());
    const book = first.findById(1, id)!;

    book.addSourceReference({
      platform: "zlibrary",
      sourceBookId: "source-added",
      sourceUrl: "https://example.test/source-added",
      hash: "hash-added",
    }, "2026-08-26T02:00:00.000Z");

    expect(first.save(book, 1)).toBe("saved");
    expect(first.findById(1, id)?.sourceReferences).toEqual([
      expect.objectContaining({
        platform: "zlibrary",
        sourceBookId: "source-added",
        sourceUrl: "https://example.test/source-added",
        hash: "hash-added",
      }),
    ]);
    expect(firstService.getDatabase().prepare(`
      SELECT sr.source_platform, sr.source_book_id, sr.source_url, sr.is_primary, b.version
      FROM source_refs sr
      INNER JOIN books b ON b.id = sr.book_id
      WHERE sr.book_id = ?
    `).get(id)).toEqual({
      source_platform: "zlibrary",
      source_book_id: "source-added",
      source_url: "https://example.test/source-added",
      is_primary: 1,
      version: 2,
    });
  });

  it("does not persist a stale source reference when the Book CAS loses", () => {
    const id = first.insert(manualBook());
    const winning = first.findById(1, id)!;
    const stale = second.findById(1, id)!;

    winning.editMetadata({ title: "Winning title" }, "2026-08-26T01:00:00.000Z");
    expect(first.save(winning, 1)).toBe("saved");
    stale.addSourceReference({
      platform: "zlibrary",
      sourceBookId: "stale-source",
    }, "2026-08-26T01:00:01.000Z");

    expect(second.save(stale, 1)).toBe("conflict");
    expect(first.findById(1, id)).toMatchObject({
      version: 2,
      sourceReferences: [],
    });
  });

  it("rolls back the Book CAS when synchronizing source_refs fails", () => {
    const existingId = first.insert(newBook());
    const targetId = first.insert(manualBook("Target Book"));
    const target = first.findById(1, targetId)!;
    target.editMetadata({ title: "Must roll back" }, "2026-08-26T03:00:00.000Z");
    target.addSourceReference({
      platform: "zlibrary",
      sourceBookId: "source-1",
      sourceUrl: "https://example.test/conflict",
    }, "2026-08-26T03:00:01.000Z");

    expect(() => first.save(target, 1)).toThrow(/UNIQUE constraint failed/);

    const persisted = first.findById(1, targetId)!;
    expect(persisted.metadata.title).toBe("Target Book");
    expect(persisted.version).toBe(1);
    expect(persisted.sourceReferences).toEqual([]);
    expect(first.findById(1, existingId)?.sourceReferences).toHaveLength(1);
  });

  function newBook(): Book {
    return Book.create({
      ownerId: 1,
      metadata: { title: "Source Book", authors: ["Author"] },
      sourceReference: {
        platform: "zlibrary",
        sourceBookId: "source-1",
        sourceUrl: "https://example.test/source-1",
        hash: "hash-1",
      },
      now: "2026-08-26T00:00:00.000Z",
    });
  }

  function manualBook(title = "Manual Book"): Book {
    return Book.create({
      ownerId: 1,
      metadata: { title, authors: ["Author"] },
      now: "2026-08-26T00:00:00.000Z",
    });
  }
});
