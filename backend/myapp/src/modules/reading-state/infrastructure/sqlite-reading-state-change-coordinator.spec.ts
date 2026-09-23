import { DatabaseSync } from "node:sqlite";
import { SqliteService } from "../../../platform/persistence/sqlite/sqlite.service";
import { ReadingStateEventBus } from "../application/reading-state-event-bus";
import { SqliteReadingStateChangeCoordinator } from "./sqlite-reading-state-change-coordinator";
import { SqliteReadingStateVersionRepository } from "./sqlite-reading-state-version.repository";

describe("SqliteReadingStateChangeCoordinator", () => {
  let database: DatabaseSync;
  let events: ReadingStateEventBus;

  beforeEach(() => {
    database = new DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE sample_state (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE reading_state_versions (
        user_id INTEGER NOT NULL,
        book_id INTEGER NOT NULL,
        revision INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, book_id)
      );
    `);
    events = new ReadingStateEventBus();
  });

  it("commits the state mutation and revision before publishing", () => {
    const published = jest.fn();
    events.subscribe({ userId: 1, bookId: 7 }, published);
    const coordinator = new SqliteReadingStateChangeCoordinator(
      { getDatabase: () => database } as unknown as SqliteService,
      events,
      new SqliteReadingStateVersionRepository({ getDatabase: () => database } as unknown as SqliteService),
    );

    const result = coordinator.transact(
      { userId: 1, changed: ["annotations"] },
      () => {
        database.prepare("INSERT INTO sample_state (id, value) VALUES (1, 'saved')").run();
        return { value: "ok", bookId: 7, didChange: true };
      },
    );

    expect(result).toBe("ok");
    expect(database.prepare("SELECT value FROM sample_state WHERE id = 1").get()).toEqual({ value: "saved" });
    expect(database.prepare("SELECT revision FROM reading_state_versions WHERE user_id = 1 AND book_id = 7").get())
      .toEqual({ revision: 1 });
    expect(published).toHaveBeenCalledWith(expect.objectContaining({ revision: 1 }));
  });

  it("rolls back the state mutation and does not publish when revision recording fails", () => {
    const published = jest.fn();
    events.subscribe({ userId: 1, bookId: 7 }, published);
    database.exec(`
      CREATE TRIGGER fail_reading_state_revision
      BEFORE INSERT ON reading_state_versions
      BEGIN
        SELECT RAISE(ABORT, 'revision failed');
      END;
    `);
    const coordinator = new SqliteReadingStateChangeCoordinator(
      { getDatabase: () => database } as unknown as SqliteService,
      events,
      new SqliteReadingStateVersionRepository({ getDatabase: () => database } as unknown as SqliteService),
    );

    expect(() => coordinator.transact(
      { userId: 1, changed: ["annotations"] },
      () => {
        database.prepare("INSERT INTO sample_state (id, value) VALUES (1, 'must rollback')").run();
        return { value: undefined, bookId: 7, didChange: true };
      },
    )).toThrow("revision failed");

    expect(database.prepare("SELECT * FROM sample_state").all()).toEqual([]);
    expect(published).not.toHaveBeenCalled();
  });

  it("does not bump or publish for an idempotent no-op", () => {
    const published = jest.fn();
    events.subscribe({ userId: 1, bookId: 7 }, published);
    const coordinator = new SqliteReadingStateChangeCoordinator(
      { getDatabase: () => database } as unknown as SqliteService,
      events,
      new SqliteReadingStateVersionRepository({ getDatabase: () => database } as unknown as SqliteService),
    );

    expect(coordinator.transact(
      { userId: 1, changed: ["bookmarks"] },
      () => ({ value: "existing", bookId: 7, didChange: false }),
    )).toBe("existing");

    expect(database.prepare("SELECT * FROM reading_state_versions").all()).toEqual([]);
    expect(published).not.toHaveBeenCalled();
  });
});
