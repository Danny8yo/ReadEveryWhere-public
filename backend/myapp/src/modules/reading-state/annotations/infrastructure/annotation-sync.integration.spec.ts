import { DatabaseSync } from "node:sqlite";
import { initializeSchema } from "../../../../platform/persistence/sqlite/schema-migrations";
import { SqliteService } from "../../../../platform/persistence/sqlite/sqlite.service";
import {
  ReadingStateEventBus,
  type ReadingStateChangedEvent,
} from "../../application/reading-state-event-bus";
import { SqliteReadingStateChangeCoordinator } from "../../infrastructure/sqlite-reading-state-change-coordinator";
import { SqliteReadingStateVersionRepository } from "../../infrastructure/sqlite-reading-state-version.repository";
import { CreateAnnotationUseCase } from "../application/use-cases/create-annotation.use-case";
import { DeleteAnnotationUseCase } from "../application/use-cases/delete-annotation.use-case";
import { UpdateAnnotationUseCase } from "../application/use-cases/update-annotation.use-case";
import { SqliteAnnotationRepository } from "./sqlite-annotation.repository";

const now = "2026-10-17T00:00:00.000Z";

// 编号对应 doc/同步测试用例审查.md
// 真实数据库 + 真实事务协调器 + 真实事件总线，只把"书是否归属当前用户"替换为恒真。
describe("笔记增删改与同步通知（G11）", () => {
  let db: DatabaseSync;
  let published: ReadingStateChangedEvent[];
  let versions: SqliteReadingStateVersionRepository;
  let create: CreateAnnotationUseCase;
  let update: UpdateAnnotationUseCase;
  let remove: DeleteAnnotationUseCase;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys=ON");
    initializeSchema(db);
    db.prepare(
      "INSERT INTO users(id,email,password_hash,created_at,updated_at) VALUES(1,'notes@example.test','x',?,?)",
    ).run(now, now);
    db.prepare(`
      INSERT INTO books (id, user_id, title, title_normalized, authors_json, authors_text, version, created_at, updated_at)
      VALUES (7, 1, 'Book', 'book', '[]', '', 1, ?, ?)
    `).run(now, now);
    const sqlite = { getDatabase: () => db } as unknown as SqliteService;
    const events = new ReadingStateEventBus();
    published = [];
    events.subscribe({ userId: 1, bookId: 7 }, (event) => published.push(event));
    versions = new SqliteReadingStateVersionRepository(sqlite);
    const changes = new SqliteReadingStateChangeCoordinator(sqlite, events, versions);
    const annotations = new SqliteAnnotationRepository(sqlite);
    create = new CreateAnnotationUseCase(annotations, { isOwnedByUser: () => true } as never, changes);
    update = new UpdateAnnotationUseCase(annotations, changes);
    remove = new DeleteAnnotationUseCase(annotations, changes);
  });
  afterEach(() => db.close());

  function createNote() {
    return create.execute(1, {
      bookId: 7,
      bookHash: "hash",
      annotationType: "highlight",
      color: "#ffeb3b",
      location: "epubcfi(/6/4!/4/2/1:0)",
      locationType: "epubcfi",
      textContent: "同步",
      contextBefore: null,
      contextAfter: null,
      chapterLabel: null,
      sortKey: 1,
      note: null,
    });
  }

  it("G11 新建笔记 → 同一本书的其他设备收到\"笔记变了\"的通知，版本号与快照一致", () => {
    createNote();
    expect(published).toEqual([
      expect.objectContaining({ userId: 1, bookId: 7, changed: ["annotations"], revision: 1 }),
    ]);
    expect(versions.getRevision(1, 7)).toBe(1);
  });

  it("G11 修改笔记 → 收到通知；修改遇到冲突 → 不通知", () => {
    const note = createNote();
    published = [];
    update.execute(1, note.id, { color: "#e53935", revision: note.revision });
    expect(published).toEqual([
      expect.objectContaining({ changed: ["annotations"], revision: 2 }),
    ]);
    published = [];
    expect(() => update.execute(1, note.id, { note: "旧版本上的修改", revision: note.revision })).toThrow();
    expect(published).toEqual([]);
  });

  it("G11 提交的修改没有带任何字段 → 笔记版本不变，不通知", () => {
    const note = createNote();
    published = [];
    const result = update.execute(1, note.id, { revision: note.revision });
    expect(result.revision).toBe(note.revision);
    expect(published).toEqual([]);
    expect(versions.getRevision(1, 7)).toBe(1);
  });

  it("G11 带了字段但值与原来相同 → 笔记版本号仍会 +1，因此必须通知（否则其他设备下次修改会误报冲突）", () => {
    const note = createNote();
    published = [];
    const result = update.execute(1, note.id, { color: note.color, revision: note.revision });
    expect(result.revision).toBe(note.revision + 1);
    expect(published).toEqual([expect.objectContaining({ changed: ["annotations"] })]);
  });

  it("G11 删除笔记 → 收到通知；用旧版本号删除 → 冲突且不通知", () => {
    const note = createNote();
    update.execute(1, note.id, { color: "#e53935", revision: note.revision });
    published = [];
    expect(() => remove.execute(1, note.id, note.revision)).toThrow();
    expect(published).toEqual([]);
    remove.execute(1, note.id, note.revision + 1);
    expect(published).toEqual([
      expect.objectContaining({ changed: ["annotations"], revision: 3 }),
    ]);
  });
});
