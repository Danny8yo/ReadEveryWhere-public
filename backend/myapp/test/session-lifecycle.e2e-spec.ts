import type { INestApplication } from "@nestjs/common";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { SqliteService } from "../src/platform/persistence/sqlite/sqlite.service";
import { authCookie, sessionHeaders } from "./auth-session.helper";
import { createCompatApp, registerUser } from "./compat-e2e.helper";

describe("Persisted browser session lifecycle (e2e)", () => {
  let app: INestApplication;
  let root: string;
  let cookie: string;
  const keys = ["SESSION_IDLE_TTL_SECONDS", "SESSION_ABSOLUTE_TTL_SECONDS", "SESSION_RENEW_INTERVAL_SECONDS", "SESSION_COOKIE_SECURE", "CORS_ORIGIN"];
  const previous = new Map(keys.map(key => [key, process.env[key]]));

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "rew-session-e2e-"));
    process.env.SESSION_IDLE_TTL_SECONDS = "60";
    process.env.SESSION_ABSOLUTE_TTL_SECONDS = "300";
    process.env.SESSION_RENEW_INTERVAL_SECONDS = "10";
    process.env.SESSION_COOKIE_SECURE = "auto";
    process.env.CORS_ORIGIN = "http://localhost:5173";
    app = await createCompatApp(root);
    await app.listen(0, "127.0.0.1");
    cookie = (await registerUser(app, "session@example.com")).sessionCookie;
  });

  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const database = () => app.get(SqliteService).getDatabase();
  const hash = () => createHash("sha256").update(cookie.slice("re_session=".length)).digest("hex");
  const row = () => database().prepare("SELECT * FROM auth_sessions WHERE token_hash=?").get(hash())!;
  const getSession = (value = cookie) => request(app.getHttpServer()).get("/api/v1/auth/session").set(sessionHeaders(value));
  const login = () => request(app.getHttpServer()).post("/api/v1/auth/login").set("Origin", "http://localhost:5173").send({ email: "session@example.com", password: "Password123!" }).expect(200);

  it("sets an HttpOnly same-site HTTP cookie and never exposes credentials in JSON", async () => {
    const result = await login();
    expect(result.headers["set-cookie"][0]).toMatch(/re_session=[A-Za-z0-9_-]{64}; Path=\/api;/);
    expect(result.headers["set-cookie"][0]).toContain("HttpOnly");
    expect(result.headers["set-cookie"][0]).toContain("SameSite=Lax");
    expect(result.headers["set-cookie"][0]).not.toContain("Secure");
    expect(Object.keys(result.body.data)).toEqual(["user"]);
    expect(row().token_hash).toBe(hash());
    expect(JSON.stringify(row())).not.toContain(cookie.slice("re_session=".length));
    const session = await getSession().expect(200);
    expect(session.headers["cache-control"]).toContain("no-store");
    expect(Object.keys(session.body.data)).toEqual(["user"]);
  });

  it("concurrent requests renew one stable credential without invalidating other requests", async () => {
    const now = Date.now();
    database().prepare("UPDATE auth_sessions SET created_at=?,renewed_at=?,expires_at=? WHERE token_hash=?")
      .run(now - 20000, now - 11000, now + 20000, hash());
    const absolute = row().absolute_expires_at;
    const results = await Promise.all(Array.from({ length: 12 }, () => getSession().expect(200)));
    expect(results.every(result => result.body.data.user.email === "session@example.com")).toBe(true);
    expect(Number(row().expires_at)).toBeGreaterThan(now + 50000);
    expect(row().absolute_expires_at).toBe(absolute);
    expect(database().prepare("SELECT count(*) AS count FROM auth_sessions").get()!.count).toBe(1);
    // A client that missed every response still owns the same valid credential.
    await getSession().expect(200);
  });

  it("caps sliding renewal at the absolute deadline", async () => {
    const now = Date.now();
    database().prepare("UPDATE auth_sessions SET created_at=?,renewed_at=?,expires_at=?,absolute_expires_at=? WHERE token_hash=?")
      .run(now - 20000, now - 11000, now + 5000, now + 15000, hash());
    await getSession().expect(200);
    expect(row().expires_at).toBe(now + 15000);
    expect(row().absolute_expires_at).toBe(now + 15000);
  });

  it.each(["idle", "absolute"])("rejects %s expiry and never resurrects an expired session", async (kind) => {
    const now = Date.now();
    database().prepare("UPDATE auth_sessions SET created_at=?,renewed_at=?,expires_at=?,absolute_expires_at=? WHERE token_hash=?")
      .run(now - 60000, now - 30000, now - 1, kind === "absolute" ? now - 1 : now + 60000, hash());
    await getSession().expect(401);
    expect(row().expires_at).toBe(now - 1);
  });

  it("revokes the current session immediately without logging out a second device", async () => {
    const otherCookie = authCookie(await login());
    const logout = await request(app.getHttpServer()).post("/api/v1/auth/logout").set(sessionHeaders(cookie)).expect(200);
    expect(logout.headers["set-cookie"][0]).toContain("re_session=;");
    await request(app.getHttpServer()).get("/api/v1/library/books").set(sessionHeaders(cookie)).expect(401);
    await getSession(otherCookie).expect(200);
  });

  it("retains sessions and user data across application restart", async () => {
    const userId = (await getSession().expect(200)).body.data.user.userId;
    await app.close();
    app = await createCompatApp(root);
    await app.listen(0, "127.0.0.1");
    const result = await getSession().expect(200);
    expect(result.body.data.user.userId).toBe(userId);
    await request(app.getHttpServer()).get("/api/v1/library/books").set(sessionHeaders(cookie)).expect(200);
  });

  it("password change revokes all older sessions and issues one new session", async () => {
    const otherCookie = authCookie(await login());
    const result = await request(app.getHttpServer()).post("/api/v1/auth/reset-password").set(sessionHeaders(cookie))
      .send({ currentPassword: "Password123!", newPassword: "NewPassword123!", confirmPassword: "NewPassword123!" }).expect(200);
    await getSession().expect(401);
    await getSession(otherCookie).expect(401);
    await getSession(authCookie(result)).expect(200);
  });

  it.each([undefined, "null", "https://attacker.example"])("rejects untrusted write Origin %s, including public login", async (origin) => {
    let logout = request(app.getHttpServer()).post("/api/v1/auth/logout").set("Cookie", cookie);
    let signIn = request(app.getHttpServer()).post("/api/v1/auth/login").send({ email: "session@example.com", password: "Password123!" });
    if (origin !== undefined) { logout = logout.set("Origin", origin); signIn = signIn.set("Origin", origin); }
    await logout.expect(403);
    await signIn.expect(403);
    await getSession().expect(200);
  });

  it("uses Secure for HTTPS only when the proxy is trusted", async () => {
    const untrusted = await request(app.getHttpServer()).post("/api/v1/auth/login")
      .set("Origin", "http://localhost:5173").set("X-Forwarded-Proto", "https")
      .send({ email: "session@example.com", password: "Password123!" }).expect(200);
    expect(untrusted.headers["set-cookie"][0]).not.toContain("Secure");
    app.getHttpAdapter().getInstance().set("trust proxy", "loopback");
    const trusted = await request(app.getHttpServer()).post("/api/v1/auth/login")
      .set("Origin", "http://localhost:5173").set("X-Forwarded-Proto", "https")
      .send({ email: "session@example.com", password: "Password123!" }).expect(200);
    expect(trusted.headers["set-cookie"][0]).toContain("Secure");
  });
});
