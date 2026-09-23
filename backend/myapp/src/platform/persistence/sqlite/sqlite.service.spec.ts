import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { SqliteService } from "./sqlite.service";

describe("SqliteService concurrency pragmas", () => {
  it("enables WAL, normal synchronous mode, foreign keys, and bounded busy timeout", () => {
    const root = mkdtempSync(resolve(tmpdir(), "sqlite-pragmas-"));
    const previous = process.env.SQLITE_PATH;
    process.env.SQLITE_PATH = resolve(root, "database.sqlite");
    const service = new SqliteService();
    try {
      service.onModuleInit();
      const database = service.getDatabase();
      expect(database.prepare("PRAGMA journal_mode").get()).toMatchObject({ journal_mode: "wal" });
      expect(database.prepare("PRAGMA synchronous").get()).toMatchObject({ synchronous: 1 });
      expect(database.prepare("PRAGMA foreign_keys").get()).toMatchObject({ foreign_keys: 1 });
      expect(database.prepare("PRAGMA busy_timeout").get()).toMatchObject({ timeout: 5000 });
    } finally {
      service.onApplicationShutdown();
      rmSync(root, { recursive: true, force: true });
      if (previous === undefined) delete process.env.SQLITE_PATH;
      else process.env.SQLITE_PATH = previous;
    }
  });
});
