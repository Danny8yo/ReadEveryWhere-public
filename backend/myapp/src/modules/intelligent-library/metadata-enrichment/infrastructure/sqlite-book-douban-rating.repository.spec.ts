import { LibrarySyncState } from "../../library-sync/library-sync-state";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { SqliteService } from "../../../../platform/persistence/sqlite/sqlite.service";
import { SaveDoubanRatingUseCase } from "../application/save-douban-rating.use-case";
import { SqliteBookDoubanRatingRepository } from "./sqlite-book-douban-rating.repository";

describe("saved Douban rating", () => {
  let root: string;
  let sqlite: SqliteService;
  let previousPath: string | undefined;

  beforeEach(() => {
    previousPath = process.env.SQLITE_PATH;
    root = mkdtempSync(resolve(tmpdir(), "book-rating-"));
    process.env.SQLITE_PATH = resolve(root, "rating.sqlite");
    sqlite = new SqliteService();
    sqlite.onModuleInit();
    const database = sqlite.getDatabase();
    const now = "2026-08-31T00:00:00.000Z";
    database.prepare(`
      INSERT INTO users (id, email, password_hash, created_at, updated_at)
      VALUES (1, 'rating@example.test', 'hash', ?, ?)
    `).run(now, now);
    database.prepare(`
      INSERT INTO books (
        id, user_id, title, title_normalized, authors_json, authors_text,
        version, created_at, updated_at
      ) VALUES (42, 1, 'Rated Book', 'rated book', '["Author"]', 'Author',
        1, ?, ?)
    `).run(now, now);
  });

  afterEach(() => {
    sqlite.onApplicationShutdown();
    rmSync(root, { recursive: true, force: true });
    if (previousPath === undefined) delete process.env.SQLITE_PATH;
    else process.env.SQLITE_PATH = previousPath;
  });

  it("upserts the selected candidate without changing the Book version", () => {
    const sync = new LibrarySyncState();
    const repository = new SqliteBookDoubanRatingRepository(sqlite, sync);
    const books = { getBook: jest.fn().mockReturnValue({ id: 42 }) } as any;
    const useCase = new SaveDoubanRatingUseCase(books, repository, () => "2026-08-31T01:00:00.000Z");
    const candidate = {
      sourcePlatform: "douban" as const,
      sourceBookId: "subject-42",
      sourceUrl: "https://book.douban.com/subject/42/",
      title: "Rated Book",
      authors: ["Author"],
      publisher: "Publisher",
      publishYear: 2026,
      isbn: "9780000000042",
      rating: 8.4,
      ratingCount: 100,
    };

    useCase.execute(1, 42, candidate);
    const saved = useCase.execute(1, 42, { ...candidate, rating: 8.6, ratingCount: 120 });

    expect(sync.version(1).revision).toBe(2);
    expect(saved).toMatchObject({ rating: 8.6, ratingCount: 120, fetchedAt: "2026-08-31T01:00:00.000Z" });
    expect(sqlite.getDatabase().prepare("SELECT version FROM books WHERE id = 42").get()).toEqual({ version: 1 });
    expect(sqlite.getDatabase().prepare("SELECT COUNT(*) AS count FROM book_douban_ratings").get()).toEqual({ count: 1 });
  });

  it("rejects a book outside the user library and cascades snapshots on deletion", () => {
    const repository = new SqliteBookDoubanRatingRepository(sqlite, new LibrarySyncState());
    const missing = new SaveDoubanRatingUseCase(
      { getBook: jest.fn().mockReturnValue(null) },
      repository,
    );
    const candidate = {
      sourcePlatform: "douban" as const,
      sourceBookId: "subject-42",
      sourceUrl: "https://book.douban.com/subject/42/",
      title: "Rated Book",
      authors: [],
      publisher: null,
      publishYear: null,
      isbn: null,
      rating: 8.4,
      ratingCount: 100,
    };
    expect(() => missing.execute(2, 42, candidate)).toThrow("Book not found");

    const owned = new SaveDoubanRatingUseCase(
      { getBook: jest.fn().mockReturnValue({ id: 42 }) } as any,
      repository,
    );
    owned.execute(1, 42, candidate);
    sqlite.getDatabase().prepare("DELETE FROM books WHERE id = 42").run();
    expect(sqlite.getDatabase().prepare("SELECT COUNT(*) AS count FROM book_douban_ratings").get())
      .toEqual({ count: 0 });
  });
});
