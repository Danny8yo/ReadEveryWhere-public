import { DatabaseSync } from "node:sqlite";
import { SessionValidityAdapter } from "./session-validity.adapter";
import { SqliteService } from "../../../../../platform/persistence/sqlite/sqlite.service";
describe("SessionValidityAdapter", () => {
  let db: DatabaseSync, validity: SessionValidityAdapter;
  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec(
      "CREATE TABLE auth_sessions(id TEXT,user_id INTEGER,expires_at INTEGER,absolute_expires_at INTEGER)",
    );
    validity = new SessionValidityAdapter({
      getDatabase: () => db,
    } as SqliteService);
  });
  afterEach(() => db.close());
  it("checks identity and both expiry limits without renewing or writing", () => {
    db.prepare("INSERT INTO auth_sessions VALUES('session',1,?,?)").run(
      Date.now() + 60_000,
      Date.now() + 120_000,
    );
    const before = db.prepare("SELECT * FROM auth_sessions").all();
    expect(validity.isActive({ sessionId: "session", userId: 1 })).toBe(true);
    expect(validity.isActive({ sessionId: "session", userId: 2 })).toBe(false);
    expect(validity.isActive({ sessionId: "missing", userId: 1 })).toBe(false);
    expect(db.prepare("SELECT * FROM auth_sessions").all()).toEqual(before);
    db.exec("UPDATE auth_sessions SET absolute_expires_at=0");
    expect(validity.isActive({ sessionId: "session", userId: 1 })).toBe(false);
  });
  it("does not disguise database errors as inactive sessions", () => {
    db.exec("DROP TABLE auth_sessions");
    expect(() =>
      validity.isActive({ sessionId: "session", userId: 1 }),
    ).toThrow();
  });
});
