import type { INestApplication } from "@nestjs/common";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { authCookie, sessionHeaders } from "./auth-session.helper";
import { createCompatApp, registerUser } from "./compat-e2e.helper";

jest.setTimeout(30_000);

type StreamEvent = { event: string; data: unknown };
type Stream = {
  status: number;
  body: unknown;
  events: StreamEvent[];
  ended: boolean;
  close(): void;
};

// 编号对应 doc/同步测试用例审查.md
// 真实 Nest 应用 + 真实 SQLite + 真实 SSE 连接，覆盖两个推送接口本身的行为。
describe("书架与笔记推送接口（真实 SSE）", () => {
  let app: INestApplication;
  let root: string;
  let base: string;
  const opened: Stream[] = [];

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "rew-realtime-sync-e2e-"));
    app = await createCompatApp(root);
    await app.listen(0, "127.0.0.1");
    base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  });

  afterEach(async () => {
    for (const stream of opened.splice(0)) stream.close();
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  async function connect(path: string, cookie?: string): Promise<Stream> {
    const abort = new AbortController();
    const response = await fetch(`${base}${path}`, {
      headers: cookie ? { Cookie: cookie } : {},
      signal: abort.signal,
    });
    const stream: Stream = {
      status: response.status,
      body: undefined,
      events: [],
      ended: false,
      close: () => abort.abort(),
    };
    opened.push(stream);
    if (!response.headers.get("content-type")?.includes("text/event-stream")) {
      stream.body = await response.json();
      stream.ended = true;
      return stream;
    }
    const reader = response.body!.getReader();
    void (async () => {
      let buffer = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += new TextDecoder().decode(value);
          let end: number;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const event = /^event:(.*)$/m.exec(frame)?.[1]?.trim();
            const data = /^data:(.*)$/m.exec(frame)?.[1];
            if (event) stream.events.push({ event, data: data ? JSON.parse(data) : undefined });
          }
        }
      } catch {
        // 连接被服务器断开或被本端中止
      }
      stream.ended = true;
    })();
    await waitFor(() => stream.events.some((e) => e.event === "ready"), "就绪消息");
    return stream;
  }

  async function waitFor(condition: () => boolean, what: string, timeoutMs = 5_000) {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error(`等待超时：${what}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  const named = (stream: Stream, event: string) => stream.events.filter((e) => e.event === event);

  async function login(email: string) {
    const result = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .set("Origin", "http://localhost:5173")
      .send({ email, password: "Password123!" })
      .expect(200);
    return authCookie(result);
  }

  async function createBook(cookie: string, title: string): Promise<number> {
    const result = await request(app.getHttpServer())
      .post("/api/v1/library/books")
      .set(sessionHeaders(cookie))
      .send({ title, authors: ["Author"] })
      .expect(201);
    return Number(result.body.data.id);
  }

  async function syncState(cookie: string) {
    const result = await request(app.getHttpServer())
      .get("/api/v1/library/sync-state")
      .set(sessionHeaders(cookie))
      .expect(200);
    return result.body.data.libraryVersion as { epoch: string; revision: number };
  }

  async function createNote(cookie: string, bookId: number, textContent: string) {
    await request(app.getHttpServer())
      .post("/api/v1/annotations")
      .set(sessionHeaders(cookie))
      .send({ bookId, bookHash: "hash", annotationType: "highlight", color: "#ffeb3b", location: `epubcfi(/6/4!/4/${Date.now()}:0)`, textContent })
      .expect(201);
  }

  it("G12 未登录不能连接书架推送", async () => {
    const stream = await connect("/api/v1/library/stream");
    expect(stream.status).toBe(401);
    expect(stream.events).toEqual([]);
  });

  it("G12 连接就绪时告知当前版本号，与版本查询结果一致", async () => {
    const { sessionCookie } = await registerUser(app, "ready@example.com");
    await createBook(sessionCookie, "Before connect");
    const stream = await connect("/api/v1/library/stream", sessionCookie);
    expect(named(stream, "ready")[0]!.data).toEqual({ libraryVersion: await syncState(sessionCookie) });
    expect((named(stream, "ready")[0]!.data as { libraryVersion: { revision: number } }).libraryVersion.revision).toBeGreaterThan(0);
  });

  it("G12 只收到自己账号的书架变化", async () => {
    const a = await registerUser(app, "owner-a@example.com");
    const b = await registerUser(app, "owner-b@example.com");
    // 让 A 的版本号领先，串号时内容就会不同。
    await createBook(a.sessionCookie, "A before connect");
    const streamA = await connect("/api/v1/library/stream", a.sessionCookie);
    const streamB = await connect("/api/v1/library/stream", b.sessionCookie);
    await createBook(a.sessionCookie, "A only");
    await waitFor(() => named(streamA, "library_changed").length === 1, "A 收到自己的变化");
    // B 自己再改一次：如果 A 的变化串到了 B，它会排在 B 自己这条前面。
    await createBook(b.sessionCookie, "B only");
    await waitFor(() => named(streamB, "library_changed").length >= 1, "B 收到自己的变化");
    expect(named(streamB, "library_changed")).toEqual([
      { event: "library_changed", data: { libraryVersion: await syncState(b.sessionCookie) } },
    ]);
  });

  it("G13 书架推送：退出登录后，下一次推送前连接断开，且收不到这条推送", async () => {
    const { sessionCookie } = await registerUser(app, "logout-library@example.com");
    const otherDevice = await login("logout-library@example.com");
    const stream = await connect("/api/v1/library/stream", sessionCookie);
    await request(app.getHttpServer()).post("/api/v1/auth/logout").set(sessionHeaders(sessionCookie)).expect(200);
    await createBook(otherDevice, "After logout");
    await waitFor(() => stream.ended, "已退出设备的连接断开");
    expect(named(stream, "library_changed")).toEqual([]);
  });

  it("G13 笔记推送：退出登录后，下一次推送前连接断开，且收不到这条推送", async () => {
    const { sessionCookie } = await registerUser(app, "logout-notes@example.com");
    const otherDevice = await login("logout-notes@example.com");
    const bookId = await createBook(sessionCookie, "Notes book");
    const stream = await connect(`/api/v1/reading-state/stream?bookId=${bookId}`, sessionCookie);
    await request(app.getHttpServer()).post("/api/v1/auth/logout").set(sessionHeaders(sessionCookie)).expect(200);
    await createNote(otherDevice, bookId, "退出后的笔记");
    await waitFor(() => stream.ended, "已退出设备的连接断开");
    expect(named(stream, "reading_state_changed")).toEqual([]);
  });

  it("G13 对照：未退出的设备照常收到笔记推送", async () => {
    const { sessionCookie } = await registerUser(app, "notes-live@example.com");
    const otherDevice = await login("notes-live@example.com");
    const bookId = await createBook(sessionCookie, "Notes book");
    const stream = await connect(`/api/v1/reading-state/stream?bookId=${bookId}`, sessionCookie);
    await createNote(otherDevice, bookId, "另一台设备的笔记");
    await waitFor(() => named(stream, "reading_state_changed").length === 1, "收到笔记推送");
    expect(named(stream, "reading_state_changed")[0]!.data).toEqual({ bookId, revision: 1, changed: ["annotations"] });
    expect(stream.ended).toBe(false);
  });

  it("G14 订阅别人书的笔记推送 → 与订阅不存在的书得到相同的\"书不存在\"回复", async () => {
    const a = await registerUser(app, "book-owner@example.com");
    const b = await registerUser(app, "book-visitor@example.com");
    const bookOfA = await createBook(a.sessionCookie, "A private book");
    const foreign = await connect(`/api/v1/reading-state/stream?bookId=${bookOfA}`, b.sessionCookie);
    const missing = await connect("/api/v1/reading-state/stream?bookId=999999", b.sessionCookie);
    expect(foreign.status).toBe(404);
    expect(foreign.status).toBe(missing.status);
    // requestId 和 timestamp 每次请求都不同，其余内容必须完全一致。
    const comparable = ({ requestId: _id, timestamp: _at, ...rest }: Record<string, unknown>) => rest;
    expect(comparable(foreign.body as Record<string, unknown>)).toEqual(comparable(missing.body as Record<string, unknown>));
  });

  it("G15 书架变化通知里的版本号与版本查询结果一致", async () => {
    const { sessionCookie } = await registerUser(app, "version@example.com");
    const stream = await connect("/api/v1/library/stream", sessionCookie);
    await createBook(sessionCookie, "First");
    await createBook(sessionCookie, "Second");
    await waitFor(() => named(stream, "library_changed").length === 2, "两条书架变化");
    expect(named(stream, "library_changed")[1]!.data).toEqual({ libraryVersion: await syncState(sessionCookie) });
  });

  it("E12 同账号 5 台设备同时在线：一台改动其余都收到；断开其中 1 台不影响其他", async () => {
    const first = await registerUser(app, "five@example.com");
    const cookies = [first.sessionCookie];
    for (let i = 0; i < 4; i++) cookies.push(await login("five@example.com"));
    const streams = await Promise.all(cookies.map((cookie) => connect("/api/v1/library/stream", cookie)));

    await createBook(cookies[0]!, "From device 1");
    await waitFor(() => streams.every((s) => named(s, "library_changed").length === 1), "5 台都收到第一次变化");

    streams[1]!.close();
    await createBook(cookies[0]!, "After one device left");
    const remaining = streams.filter((_, index) => index !== 1);
    await waitFor(() => remaining.every((s) => named(s, "library_changed").length === 2), "其余 4 台收到第二次变化");
    expect(named(streams[1]!, "library_changed")).toHaveLength(1);
  });
});
