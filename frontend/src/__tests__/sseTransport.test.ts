// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { openCookieSse } from "../shared/web/sseTransport";
const auth = vi.hoisted(() => ({ fetch: vi.fn(), version: "a" }));
vi.mock("../shared/web/apiClient", () => ({
  fetchWithAuth: auth.fetch,
  getBaseUrl: () => "/backend",
  getSessionVersion: () => auth.version,
  resolveBackendUrl: (p: string) => "http://localhost" + p,
}));

/** 一条可由测试控制的推送连接：push 发消息，end 模拟服务器断开。 */
function streamingResponse() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const response = (init: RequestInit) =>
    new Response(
      new ReadableStream({
        start(c) {
          controller = c;
          init.signal?.addEventListener("abort", () => {
            try {
              c.close();
            } catch {
              // 已关闭
            }
          });
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  return {
    response,
    push: (text: string) => controller.enqueue(new TextEncoder().encode(text)),
    end: () => controller.close(),
  };
}

function setVisibility(value: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
}

beforeEach(() => setVisibility("visible"));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  auth.version = "a";
});

// 编号对应 doc/同步测试用例审查.md
describe("公共推送连接（cookie SSE）", () => {
  it("A4 收到 401 后彻底停止重连，100 秒内只请求 1 次", async () => {
    vi.useFakeTimers();
    auth.fetch.mockResolvedValue(new Response("", { status: 401 }));
    const stop = openCookieSse("/stream", { message: vi.fn(), error: vi.fn() });
    await vi.advanceTimersByTimeAsync(100000);
    expect(auth.fetch).toHaveBeenCalledTimes(1);
    stop();
  });

  it("A5 只有心跳的 75 秒内不误判断线；关闭后不再重连", async () => {
    vi.useFakeTimers();
    const server = streamingResponse();
    auth.fetch.mockImplementation((_url, init) => Promise.resolve(server.response(init)));
    const events = vi.fn();
    const stop = openCookieSse("/stream", { message: events, error: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 5; i++) {
      server.push(": heartbeat\n\n");
      await vi.advanceTimersByTimeAsync(15000);
    }
    expect(auth.fetch).toHaveBeenCalledTimes(1);
    server.push("event: ready\ndata: {}\n\n");
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toHaveBeenCalledOnce();
    stop();
    await vi.advanceTimersByTimeAsync(100000);
    expect(auth.fetch).toHaveBeenCalledTimes(1);
  });

  it("A6 前台连接 45 秒没有任何数据 → 判定假死并重连，44 秒时不会；关闭后定时器全部释放", async () => {
    vi.useFakeTimers();
    auth.fetch.mockImplementation((_url, init) => Promise.resolve(streamingResponse().response(init)));
    const stop = openCookieSse("/stream", { message: vi.fn(), error: vi.fn() });
    await vi.advanceTimersByTimeAsync(44000);
    expect(auth.fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(auth.fetch).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("G2 登录身份变化后，旧连接的消息被丢弃、不报错，并且不再重连", async () => {
    vi.useFakeTimers();
    const server = streamingResponse();
    auth.fetch.mockImplementation((_url, init) => Promise.resolve(server.response(init)));
    const message = vi.fn(),
      error = vi.fn();
    openCookieSse("/stream", { message, error });
    await vi.advanceTimersByTimeAsync(0);
    auth.version = "b";
    server.push("event: library_changed\ndata: {}\n\n");
    await vi.advanceTimersByTimeAsync(100000);
    expect(message).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(auth.fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("G4 后台超过 45 秒无数据不重连；回到前台立即重连，不等下一次定时检查", async () => {
    vi.useFakeTimers();
    auth.fetch.mockImplementation((_url, init) => Promise.resolve(streamingResponse().response(init)));
    const stop = openCookieSse("/stream", { message: vi.fn(), error: vi.fn() });
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(60000);
    expect(auth.fetch).toHaveBeenCalledTimes(1);
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(auth.fetch).toHaveBeenCalledTimes(2);
    stop();
  });

  it("G4 后台不到 45 秒就回到前台，不重连", async () => {
    vi.useFakeTimers();
    auth.fetch.mockImplementation((_url, init) => Promise.resolve(streamingResponse().response(init)));
    const stop = openCookieSse("/stream", { message: vi.fn(), error: vi.fn() });
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(30000);
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(auth.fetch).toHaveBeenCalledTimes(1);
    stop();
  });

  it("G5 消息处理出错（如收到格式不对的消息）→ 报错并停止连接，不崩溃也不重连", async () => {
    vi.useFakeTimers();
    const server = streamingResponse();
    auth.fetch.mockImplementation((_url, init) => Promise.resolve(server.response(init)));
    const error = vi.fn();
    openCookieSse("/stream", {
      message: () => {
        throw new Error("书库同步接口不兼容，请刷新页面并确认服务器版本");
      },
      error,
    });
    await vi.advanceTimersByTimeAsync(0);
    server.push("event: library_changed\ndata: {}\n\n");
    await vi.advanceTimersByTimeAsync(100000);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("请刷新页面") }));
    expect(auth.fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("G6 服务器断开连接 → 通知上层\"正在重连\"，随后自动重连", async () => {
    vi.useFakeTimers();
    const servers: ReturnType<typeof streamingResponse>[] = [];
    auth.fetch.mockImplementation((_url, init) => {
      const server = streamingResponse();
      servers.push(server);
      return Promise.resolve(server.response(init));
    });
    const error = vi.fn();
    const stop = openCookieSse("/stream", { message: vi.fn(), error });
    await vi.advanceTimersByTimeAsync(0);
    servers[0]!.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("重连") }));
    await vi.advanceTimersByTimeAsync(3000);
    expect(auth.fetch).toHaveBeenCalledTimes(2);
    stop();
  });

  it("G6 非 401 的 4xx 错误 → 报错并停止重连", async () => {
    vi.useFakeTimers();
    auth.fetch.mockResolvedValue(new Response("", { status: 403 }));
    const error = vi.fn();
    const stop = openCookieSse("/stream", { message: vi.fn(), error });
    await vi.advanceTimersByTimeAsync(100000);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("403") }));
    expect(auth.fetch).toHaveBeenCalledTimes(1);
    stop();
  });

  it("G6 5xx 错误 → 报错但继续重连", async () => {
    vi.useFakeTimers();
    auth.fetch.mockImplementation(() => Promise.resolve(new Response("", { status: 503 })));
    const error = vi.fn();
    const stop = openCookieSse("/stream", { message: vi.fn(), error });
    await vi.advanceTimersByTimeAsync(10000);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("503") }));
    expect(auth.fetch.mock.calls.length).toBeGreaterThan(1);
    stop();
  });
});
