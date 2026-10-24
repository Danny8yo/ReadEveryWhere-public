import { createServer, type Server, type ServerResponse } from "node:http";
import { Logger } from "@nestjs/common";
import { SseTransport, type SseSink } from "./sse-transport";

// 编号对应 doc/同步测试用例审查.md
describe("公共推送连接（SseTransport，真实 better-sse 帧）", () => {
  let server: Server, url: string, sink: SseSink, response: ServerResponse;
  let transport: SseTransport;
  let active: boolean, failure: boolean;
  let cleanup: jest.Mock;
  let ready: () => unknown;
  beforeEach(async () => {
    active = true;
    failure = false;
    cleanup = jest.fn();
    ready = () => ({ revision: 1 });
    transport = new SseTransport();
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => {});
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
    server = createServer((req, res) => {
      response = res;
      transport.open(
        req as never,
        res as never,
        () => {
          if (failure) throw Error("database unavailable");
          return active;
        },
        (value) => {
          sink = value;
          return cleanup;
        },
        () => ready(),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    jest.restoreAllMocks();
  });
  async function readUntil(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    text: string,
  ) {
    let received = "";
    while (!received.includes(text)) {
      const chunk = await reader.read();
      if (chunk.done) throw Error(`连接在收到 ${text} 前结束：${received}`);
      received += new TextDecoder().decode(chunk.value);
    }
    return received;
  }
  async function open() {
    const result = await fetch(url);
    const reader = result.body!.getReader();
    await readUntil(reader, "event:ready");
    return { reader, result };
  }
  async function closed(reader: ReadableStreamDefaultReader<Uint8Array>) {
    try {
      return (await reader.read()).done;
    } catch {
      return true;
    }
  }

  it("A1 连上后先收到就绪消息；推送能到达客户端；客户端断开后服务端清理订阅", async () => {
    const abort = new AbortController();
    const result = await fetch(url, { signal: abort.signal });
    const reader = result.body!.getReader();
    await readUntil(reader, "event:ready");
    expect(result.headers.get("x-accel-buffering")).toBe("no");
    sink.send("library_changed", {
      libraryVersion: { epoch: "test", revision: 2 },
    });
    expect(await readUntil(reader, "library_changed")).toContain(
      '"revision":2',
    );
    abort.abort();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("A2 建立连接瞬间登录已失效：连接失败，心跳定时器被清理", async () => {
    const intervals = jest.spyOn(globalThis, "setInterval");
    const cleared = jest.spyOn(globalThis, "clearInterval");
    active = false;
    await expect(fetch(url)).rejects.toThrow();
    expect(intervals).toHaveBeenCalled();
    expect(cleared).toHaveBeenCalledWith(intervals.mock.results[0].value);
    expect(cleanup).not.toHaveBeenCalled();
  });

  it.each([
    ["登录已过期", "expired"],
    ["查登录状态时数据库出错", "database"],
    ["客户端积压需要排空", "backpressure"],
  ])("A3 推送前发现%s → 立即断开，这条数据不发出", async (_label, reason) => {
    const { reader } = await open();
    if (reason === "expired") active = false;
    if (reason === "database") failure = true;
    if (reason === "backpressure")
      Object.defineProperty(response, "writableNeedDrain", { value: true });
    sink.send("library_changed", { secret: "must not arrive" });
    await expect(reader.read()).rejects.toThrow();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("E3 订阅完成后、就绪消息生成前发生的变化不会丢", async () => {
    // 模拟一次变化恰好在"已订阅、正在计算就绪内容"的窗口里提交。
    ready = () => {
      sink.send("library_changed", { during: "subscribe-ready-window" });
      return { revision: 2 };
    };
    const result = await fetch(url);
    const received = await readUntil(result.body!.getReader(), "event:ready");
    expect(received).toContain("subscribe-ready-window");
  });

  it("G16 服务器关闭时主动断开所有连接并清理订阅", async () => {
    const first = await open();
    const second = await open();
    transport.onModuleDestroy();
    expect(await closed(first.reader)).toBe(true);
    expect(await closed(second.reader)).toBe(true);
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it("G16 积压不超过 64KB 时照常推送，超过 64KB 断开该客户端", async () => {
    const { reader } = await open();
    let backlog = 1024;
    Object.defineProperty(response, "writableLength", { get: () => backlog });
    sink.send("library_changed", { small: "backlog" });
    expect(await readUntil(reader, "library_changed")).toContain("backlog");
    backlog = 64 * 1024;
    sink.send("library_changed", { secret: "must not arrive" });
    await expect(reader.read()).rejects.toThrow();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
