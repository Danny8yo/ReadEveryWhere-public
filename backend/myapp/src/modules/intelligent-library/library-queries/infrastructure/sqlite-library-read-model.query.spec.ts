import { DatabaseSync } from "node:sqlite";
import { initializeSchema } from "../../../../platform/persistence/sqlite/schema-migrations";
import { SqliteService } from "../../../../platform/persistence/sqlite/sqlite.service";
import { Book } from "../../catalog/domain/book";
import { SqliteBookRepository } from "../../catalog/infrastructure/persistence/sqlite/sqlite-book.repository";
import { LibrarySyncState } from "../../library-sync/library-sync-state";
import { SqliteLibraryReadModelQuery } from "./sqlite-library-read-model.query";

const now = "2026-09-23T00:00:00.000Z";

// 编号对应 doc/同步测试用例审查.md
describe("书架列表查询（SqliteLibraryReadModelQuery）", () => {
  let db: DatabaseSync, sync: LibrarySyncState, books: SqliteBookRepository;
  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys=ON");
    initializeSchema(db);
    db.prepare(
      "INSERT INTO users(id,email,password_hash,created_at,updated_at) VALUES(1,'test@example.test','x',?,?)",
    ).run(now, now);
    sync = new LibrarySyncState();
    books = new SqliteBookRepository({ getDatabase: () => db } as SqliteService, sync);
  });
  afterEach(() => {
    sync.onModuleDestroy();
    db.close();
  });

  it("B8 同一时间创建的书分页顺序稳定（按编号决定先后）", () => {
    const create = (title: string) =>
      books.insert(Book.create({ ownerId: 1, metadata: { title, authors: ["Author"] }, now }));
    const first = create("First");
    const second = create("Second");
    const query = new SqliteLibraryReadModelQuery({ getDatabase: () => db } as SqliteService);
    expect(query.listBooks({ userId: 1, page: 1, pageSize: 1 }).items[0].id).toBe(second);
    expect(query.listBooks({ userId: 1, page: 2, pageSize: 1 }).items[0].id).toBe(first);
  });
});
