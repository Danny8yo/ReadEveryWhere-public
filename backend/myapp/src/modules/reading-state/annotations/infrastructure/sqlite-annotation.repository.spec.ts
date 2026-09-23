import { DatabaseSync } from "node:sqlite";
import { SqliteAnnotationRepository } from "./sqlite-annotation.repository";
import { SqliteService } from "../../../../platform/persistence/sqlite/sqlite.service";

const createMockDb = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, password_hash TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE books (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, title TEXT, title_normalized TEXT, authors_json TEXT, authors_text TEXT, version INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE annotations (
      id TEXT NOT NULL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      book_id INTEGER NOT NULL,
      book_hash TEXT NOT NULL,
      annotation_type TEXT NOT NULL,
      color TEXT NOT NULL,
      location TEXT NOT NULL,
      location_type TEXT NOT NULL DEFAULT 'epubcfi',
      text_content TEXT NOT NULL,
      context_before TEXT,
      context_after TEXT,
      chapter_label TEXT,
      section_index INTEGER,
      text_position_start INTEGER,
      text_position_end INTEGER,
      sort_key REAL,
      note TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_annotations_render_order ON annotations(book_id, sort_key);
    CREATE INDEX IF NOT EXISTS idx_annotations_book_hash ON annotations(book_hash);
    INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (1, 'test@test.com', 'hash', '2024-01-01', '2024-01-01');
    INSERT INTO books (id, user_id, title, title_normalized, authors_json, authors_text, created_at, updated_at) VALUES (1, 1, 'Test Book', 'test book', '["Author"]', 'Author', '2024-01-01', '2024-01-01');
  `);
  return db;
};

describe("SqliteAnnotationRepository", () => {
  let repo: SqliteAnnotationRepository;
  let db: DatabaseSync;
  const mockSqliteService = { getDatabase: () => db };

  beforeEach(() => {
    db = createMockDb();
    mockSqliteService.getDatabase = () => db;
    repo = new SqliteAnnotationRepository(mockSqliteService as unknown as SqliteService);
  });

  const now = 1700000000000;

  const sampleInput = {
    id: "ulid-001",
    userId: 1,
    bookId: 1,
    bookHash: "sha256:abc123",
    annotationType: "highlight" as const,
    color: "#ffeb3b",
    location: "epubcfi(/6/4!/4/2/1:0)",
    locationType: "epubcfi" as const,
    textContent: "测试文字",
    contextBefore: null,
    contextAfter: null,
    chapterLabel: "第一章",
    sortKey: 1.0,
    note: null,
  };

  it("creates an annotation and returns it", () => {
    const result = repo.create({ ...sampleInput, createdAt: now, updatedAt: now });
    expect(result.id).toBe("ulid-001");
    expect(result.annotationType).toBe("highlight");
    expect(result.revision).toBe(1);

  });

  it("round-trips reader-agnostic selectors (context + section + text position)", () => {
    const result = repo.create({
      ...sampleInput,
      contextBefore: "前文",
      contextAfter: "后文",
      sectionIndex: 3,
      textPositionStart: 120,
      textPositionEnd: 128,
      createdAt: now,
      updatedAt: now,
    });
    expect(result.contextBefore).toBe("前文");
    expect(result.contextAfter).toBe("后文");
    expect(result.sectionIndex).toBe(3);
    expect(result.textPositionStart).toBe(120);
    expect(result.textPositionEnd).toBe(128);

    const reloaded = repo.findById("ulid-001");
    expect(reloaded?.sectionIndex).toBe(3);
    expect(reloaded?.textPositionEnd).toBe(128);
  });

  it("defaults new selector columns to null when omitted", () => {
    const result = repo.create({ ...sampleInput, createdAt: now, updatedAt: now });
    expect(result.sectionIndex).toBeNull();
    expect(result.textPositionStart).toBeNull();
    expect(result.textPositionEnd).toBeNull();
  });

  it("findByBook excludes hard-deleted annotations", () => {
    repo.create({ ...sampleInput, createdAt: now, updatedAt: now });
    repo.create({ ...sampleInput, id: "ulid-002", location: "epubcfi(/6/4!/4/2/2:0)", createdAt: now, updatedAt: now });
    repo.deleteAnnotation("ulid-002", 1, 1);

    const results = repo.findByBook(1, 1);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("ulid-001");
  });

  it("findByBook orders by sort_key ASC", () => {
    repo.create({ ...sampleInput, id: "ulid-a", sortKey: 3.0, location: "epubcfi(/6/4!/4/2/3:0)", createdAt: now, updatedAt: now });
    repo.create({ ...sampleInput, id: "ulid-b", sortKey: 1.0, location: "epubcfi(/6/4!/4/2/1:0)", createdAt: now, updatedAt: now });
    repo.create({ ...sampleInput, id: "ulid-c", sortKey: 2.0, location: "epubcfi(/6/4!/4/2/2:0)", createdAt: now, updatedAt: now });

    const results = repo.findByBook(1, 1);
    expect(results.map((r) => r.id)).toEqual(["ulid-b", "ulid-c", "ulid-a"]);
  });

  it("findById returns null for non-existent annotation", () => {
    expect(repo.findById("nonexistent")).toBeNull();
  });

  it("updateAnnotation updates color and note", () => {
    repo.create({ ...sampleInput, createdAt: now, updatedAt: now });
    const updated = repo.updateAnnotation({
      userId: 1,
      annotationId: "ulid-001",
      color: "#a5d6a7",
      note: "新批注",
      expectedRevision: 1,
      updatedAt: now + 1000,
    });
    expect(updated.kind).toBe("updated");
    if (updated.kind !== "updated") throw new Error("expected updated");
    expect(updated.annotation.color).toBe("#a5d6a7");
    expect(updated.annotation.note).toBe("新批注");
    expect(updated.annotation.revision).toBe(2);
  });

  it("updateAnnotation can overwrite the annotation type (highlight → underline)", () => {
    repo.create({ ...sampleInput, createdAt: now, updatedAt: now });
    const updated = repo.updateAnnotation({
      userId: 1,
      annotationId: "ulid-001",
      annotationType: "underline",
      color: "#90caf9",
      expectedRevision: 1,
      updatedAt: now + 1000,
    });
    expect(updated.kind).toBe("updated");
    if (updated.kind !== "updated") throw new Error("expected updated");
    expect(updated.annotation.annotationType).toBe("underline");
    expect(updated.annotation.color).toBe("#90caf9");
    // 类型持久化
    expect(repo.findById("ulid-001")?.annotationType).toBe("underline");
  });

  it("deleteAnnotation removes the annotation at the expected revision", () => {
    repo.create({ ...sampleInput, createdAt: now, updatedAt: now });
    expect(repo.deleteAnnotation("ulid-001", 1, 1).kind).toBe("deleted");
    const result = repo.findById("ulid-001");
    expect(result).toBeNull();
  });

  it("findByIdempotencyKey finds by (book_hash, location, textContent)", () => {
    repo.create({ ...sampleInput, createdAt: now, updatedAt: now });
    const found = repo.findByIdempotencyKey(1, "sha256:abc123", "epubcfi(/6/4!/4/2/1:0)", "测试文字");
    expect(found).not.toBeNull();
    expect(found!.id).toBe("ulid-001");

    repo.deleteAnnotation("ulid-001", 1, 1);
    const notFound = repo.findByIdempotencyKey(1, "sha256:abc123", "epubcfi(/6/4!/4/2/1:0)", "测试文字");
    expect(notFound).toBeNull();
  });

  it("returns the current record when update uses a stale revision", () => {
    repo.create({ ...sampleInput, createdAt: now, updatedAt: now });
    const first = repo.updateAnnotation({
      userId: 1,
      annotationId: "ulid-001",
      note: "server",
      expectedRevision: 1,
      updatedAt: now + 1,
    });
    expect(first.kind).toBe("updated");
    const stale = repo.updateAnnotation({
      userId: 1,
      annotationId: "ulid-001",
      note: "stale client",
      expectedRevision: 1,
      updatedAt: now + 2,
    });
    expect(stale).toMatchObject({
      kind: "conflict",
      current: { note: "server", revision: 2 },
    });
  });
});
