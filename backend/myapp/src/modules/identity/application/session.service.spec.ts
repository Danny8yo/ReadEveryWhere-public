import { SessionCredentials } from "../infrastructure/security/session-credentials";
import { DatabaseSync } from "node:sqlite";
import { initializeSchema } from "../../../platform/persistence/sqlite/schema-migrations";
import type { SqliteService } from "../../../platform/persistence/sqlite/sqlite.service";
import { SessionsRepository } from "../infrastructure/persistence/sqlite/sessions.repository";
import { UsersRepository } from "../infrastructure/persistence/sqlite/users.repository";
import { SqliteIdentityTransaction } from "../infrastructure/persistence/sqlite/identity-transaction";
import { AuthService } from "./auth.service";
import { SessionService, sessionPolicy } from "./session.service";

describe("persistent sessions", () => {
  let db: DatabaseSync;
  let repository: SessionsRepository;
  let users: UsersRepository;
  let sessions: SessionService;
  let transaction: SqliteIdentityTransaction;
  let now: number;
  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    initializeSchema(db);
    const sqlite = { getDatabase: () => db } as SqliteService;
    repository = new SessionsRepository(sqlite);
    users = new UsersRepository(sqlite);
    transaction = new SqliteIdentityTransaction(sqlite);
    now = 1000;
    sessions = new SessionService(
      repository,
      { idleMs: 100, absoluteMs: 250, renewMs: 20 },
      new SessionCredentials(),
      () => now,
    );
    users.create("reader@example.test", "old-password");
  });
  afterEach(() => db.close());

  it("renews one stable credential concurrently without exceeding the absolute deadline", () => {
    const issued = sessions.create(1);
    const stored = db.prepare("SELECT * FROM auth_sessions").get()!;
    expect(stored.token_hash).not.toBe(issued.token);
    expect(String(stored.token_hash)).toHaveLength(64);
    now = 1050;
    for (let tab = 0; tab < 20; tab++)
      expect(sessions.authenticate(issued.token).userId).toBe(1);
    expect(
      db.prepare("SELECT expires_at FROM auth_sessions").get()!.expires_at,
    ).toBe(1150);
    now = 1130;
    sessions.authenticate(issued.token);
    now = 1210;
    sessions.authenticate(issued.token);
    expect(
      db.prepare("SELECT expires_at FROM auth_sessions").get()!.expires_at,
    ).toBe(1250);
    now = 1250;
    expect(() => sessions.authenticate(issued.token)).toThrow(
      "Session expired or revoked",
    );
  });

  it("rejects idle sessions, preserves sessions across adapter restart and isolates device logout", () => {
    const one = sessions.create(1),
      two = sessions.create(1);
    const restarted = new SessionService(
      repository,
      { idleMs: 100, absoluteMs: 250, renewMs: 20 },
      new SessionCredentials(),
      () => now,
    );
    const first = restarted.authenticate(one.token);
    restarted.revoke(first.id);
    expect(() => restarted.authenticate(one.token)).toThrow();
    expect(restarted.authenticate(two.token).userId).toBe(1);
    now = 1100;
    expect(() => restarted.authenticate(two.token)).toThrow();
  });

  it("does not recreate a revoked session through a late renewal", () => {
    const issued = sessions.create(1);
    const record = sessions.authenticate(issued.token);
    sessions.revoke(record.id);
    repository.renew(record.id, 1050, 1150);
    expect(() => sessions.authenticate(issued.token)).toThrow();
  });

  it("rolls back password and revocations when replacement session persistence fails", async () => {
    const issued = sessions.create(1);
    const auth = new AuthService(
      users,
      {
        hash: async (value) => value,
        compare: async (value, hash) => value === hash,
      },
      sessions,
      { info() {}, warn() {}, debug() {} },
      transaction,
    );
    jest.spyOn(repository, "create").mockImplementation(() => {
      throw new Error("disk failure");
    });
    await expect(
      auth.resetPassword(1, {
        currentPassword: "old-password",
        newPassword: "new-password",
        confirmPassword: "new-password",
      }),
    ).rejects.toThrow("disk failure");
    expect(users.findById(1)!.passwordHash).toBe("old-password");
    expect(sessions.authenticate(issued.token).userId).toBe(1);
  });

  it("rejects a pending old-password login after password reset commits", async () => {
    let finishLogin!: (result: boolean) => void;
    let blockLogin = true;
    const auth = new AuthService(
      users,
      {
        hash: async (value) => value,
        compare: (value, hash) => {
          if (blockLogin) {
            blockLogin = false;
            return new Promise((resolve) => {
              finishLogin = resolve;
            });
          }
          return Promise.resolve(value === hash);
        },
      },
      sessions,
      { info() {}, warn() {}, debug() {} },
      transaction,
    );
    const login = auth.login({
      email: "reader@example.test",
      password: "old-password",
    });
    await auth.resetPassword(1, {
      currentPassword: "old-password",
      newPassword: "new-password",
      confirmPassword: "new-password",
    });
    finishLogin(true);
    await expect(login).rejects.toThrow("Credentials changed");
    expect(db.prepare("SELECT count(*) n FROM auth_sessions").get()!.n).toBe(1);
  });

  it("validates configured lifetimes before accepting requests", () => {
    expect(() =>
      sessionPolicy({
        SESSION_IDLE_TTL_SECONDS: "1",
        SESSION_RENEW_INTERVAL_SECONDS: "1",
      }),
    ).toThrow();
    expect(() =>
      sessionPolicy({ SESSION_ABSOLUTE_TTL_SECONDS: "1" }),
    ).toThrow();
    expect(() =>
      sessionPolicy({ SESSION_IDLE_TTL_SECONDS: "garbage" }),
    ).toThrow();
  });
});
