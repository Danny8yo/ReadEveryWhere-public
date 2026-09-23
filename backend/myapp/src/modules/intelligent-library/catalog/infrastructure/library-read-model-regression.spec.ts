import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { SqliteService } from "../../../../platform/persistence/sqlite/sqlite.service";
import { SqliteLibraryReadModelQuery } from "../../library-queries/infrastructure/sqlite-library-read-model.query";

describe("library read model download task projection", () => {
  let root: string;
  let sqlite: SqliteService;
  let originalSqlitePath: string | undefined;

  beforeEach(() => {
    originalSqlitePath = process.env.SQLITE_PATH;
    root = mkdtempSync(resolve(tmpdir(), "library-read-model-"));
    process.env.SQLITE_PATH = resolve(root, "library.sqlite");
    sqlite = new SqliteService();
    sqlite.onModuleInit();

    const database = sqlite.getDatabase();
    database.prepare(`
      INSERT INTO users (id, email, password_hash, created_at, updated_at)
      VALUES (1, 'reader@example.test', 'hash', '2026-08-27T00:00:00.000Z', '2026-08-27T00:00:00.000Z')
    `).run();
    database.prepare(`
      INSERT INTO books (
        id, user_id, title, title_normalized, authors_json, authors_text,
        version, created_at, updated_at
      ) VALUES (
        10, 1, 'One Book', 'one book', '["Author"]', 'Author',
        1, '2026-08-27T00:00:00.000Z', '2026-08-27T00:00:00.000Z'
      )
    `).run();
    database.prepare(`
      INSERT INTO book_profiles (
        id, book_id, primary_genre, secondary_genres_json, traits_json,
        confidence_kind, confidence_score, classification_summary, profile_version, updated_at
      ) VALUES (
        'profile-10', 10, 'technical', '["popular-science"]', '["evidence-heavy"]',
        'user-determined', NULL, NULL, 2, '2026-08-27T00:00:00.000Z'
      )
    `).run();
    const insertTask = database.prepare(`
      INSERT INTO download_tasks (
        user_id, book_id, source_platform, source_url, delivery_id, phase,
        status, progress, created_at, updated_at
      ) VALUES (1, 10, 'zlibrary', ?, ?, ?, ?, ?, ?, ?)
    `);
    insertTask.run(
      'https://example.test/old',
      'delivery-old',
      'failed',
      'failed',
      40,
      '2026-08-27T01:00:00.000Z',
      '2026-08-27T01:01:00.000Z',
    );
    insertTask.run(
      'https://example.test/new',
      'delivery-new',
      'downloading',
      'downloading',
      70,
      '2026-08-27T02:00:00.000Z',
      '2026-08-27T02:01:00.000Z',
    );
  });

  afterEach(() => {
    sqlite.onApplicationShutdown();
    rmSync(root, { recursive: true, force: true });
    if (originalSqlitePath === undefined) delete process.env.SQLITE_PATH;
    else process.env.SQLITE_PATH = originalSqlitePath;
  });

  it("returns one book and projects only its latest download task", () => {
    const repository = new SqliteLibraryReadModelQuery(sqlite);

    const result = repository.listBooks({ userId: 1, page: 1, pageSize: 20 });

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 10,
      downloadStatus: "downloading",
      downloadProgress: 70,
      readingProfile: {
        id: "profile-10",
        primaryGenre: "technical",
        confidence: { kind: "user-determined", score: null },
        profileVersion: 2,
      },
    });
  });

  it("filters by the formal primary and secondary genres", () => {
    const repository = new SqliteLibraryReadModelQuery(sqlite);

    expect(repository.listBooks({
      userId: 1, page: 1, pageSize: 20, primaryGenre: "technical",
    }).items).toHaveLength(1);
    expect(repository.listBooks({
      userId: 1, page: 1, pageSize: 20, primaryGenre: "narrative",
    }).items).toHaveLength(0);
    expect(repository.listBooks({
      userId: 1, page: 1, pageSize: 20, secondaryGenre: "popular-science",
    }).items).toHaveLength(1);
  });

  it("filters by actual or expected ebook formats and projects a saved Douban rating", () => {
    const database = sqlite.getDatabase();
    const now = "2026-08-27T03:00:00.000Z";
    database.prepare(`
      INSERT INTO books (
        id, user_id, title, title_normalized, authors_json, authors_text,
        version, created_at, updated_at
      ) VALUES (11, 1, 'Pending EPUB', 'pending epub', '["Author"]', 'Author',
        1, ?, ?)
    `).run(now, now);
    database.prepare(`
      INSERT INTO source_refs (
        user_id, book_id, source_platform, source_book_id, source_url, hash,
        format, is_primary, availability, created_at, updated_at
      ) VALUES (1, 11, 'zlibrary', 'epub-11', NULL, 'hash-11',
        'epub', 1, 'available', ?, ?)
    `).run(now, now);
    database.prepare(`
      INSERT INTO book_profiles (
        id, book_id, secondary_genres_json, traits_json, profile_version, updated_at
      ) VALUES ('profile-11', 11, '[]', '[]', 1, ?)
    `).run(now);
    database.prepare(`
      INSERT INTO book_artifacts (
        artifact_id, delivery_id, user_id, book_id, status, stored_path,
        file_name, mime_type, file_size, checksum, managed, created_at, updated_at
      ) VALUES ('artifact-10', 'delivery-10', 1, 10, 'active', 'one.pdf',
        'one.pdf', 'application/pdf', 100, 'checksum-10', 1, ?, ?)
    `).run(now, now);
    database.prepare(`
      INSERT INTO book_current_artifacts (book_id, artifact_id, activated_at)
      VALUES (10, 'artifact-10', ?)
    `).run(now);
    database.prepare(`
      INSERT INTO source_refs (
        user_id, book_id, source_platform, source_book_id, source_url, hash,
        format, is_primary, availability, created_at, updated_at
      ) VALUES (1, 10, 'zlibrary', 'source-10', NULL, 'hash-10',
        'epub', 1, 'available', ?, ?)
    `).run(now, now);
    database.prepare(`
      INSERT INTO book_douban_ratings (
        book_id, source_book_id, source_url, source_title,
        rating, rating_count, fetched_at
      ) VALUES (10, 'subject-10', 'https://book.douban.com/subject/10/',
        'One Book', 8.7, 1200, ?)
    `).run(now);

    const repository = new SqliteLibraryReadModelQuery(sqlite);

    expect(repository.listBooks({
      userId: 1, page: 1, pageSize: 20, formats: ["pdf"],
    } as any).items.map((book) => book.id)).toEqual([10]);
    expect(repository.listBooks({
      userId: 1, page: 1, pageSize: 20, formats: ["epub"],
    } as any).items.map((book) => book.id)).toEqual([11]);
    expect(repository.listBooks({
      userId: 1, page: 1, pageSize: 20, formats: ["pdf", "epub"],
    } as any).items).toHaveLength(2);
    expect(repository.getBook(1, 10)).toMatchObject({
      format: "pdf",
      doubanRating: {
        sourceBookId: "subject-10",
        rating: 8.7,
        ratingCount: 1200,
        fetchedAt: now,
      },
    });
  });
});
