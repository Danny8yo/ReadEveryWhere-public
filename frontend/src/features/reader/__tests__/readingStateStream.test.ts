import { beforeEach, describe, it, expect, vi } from "vitest";
import { openReadingStateStream } from "../api/readingStateApi";
const transport = vi.hoisted(() => ({ open: vi.fn(() => () => {}) }));
vi.mock("../../../shared/web/sseTransport", () => ({ openCookieSse: transport.open }));

type TransportHandlers = {
  open?: () => void;
  message(event: { event?: string; data: string }): void;
  error(error: unknown): void;
};
const lastCall = () => transport.open.mock.calls.at(-1) as unknown as [string, TransportHandlers];
const changed = (data: unknown) => ({ event: "reading_state_changed", data: JSON.stringify(data) });

beforeEach(() => vi.clearAllMocks());

// 编号对应 doc/同步测试用例审查.md
describe("笔记推送消息解析", () => {
  it("C10 收到\"就绪\"才开始拉快照；拉快照期间不阻塞后续的变化消息", async () => {
    const onOpen = vi.fn(() => new Promise<void>(() => {})),
      onChange = vi.fn(),
      onError = vi.fn();
    openReadingStateStream(7, { onOpen, onChange, onError }, "device");
    const handlers = lastCall()[1];
    expect(handlers.open).toBeUndefined();
    handlers.message({ event: "ready", data: "{}" });
    handlers.message(changed({ bookId: 7, revision: 2, changed: ["annotations"] }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it("G8 连接时带上本设备编号，让服务器不把本设备的变化推回来", () => {
    openReadingStateStream(7, { onChange: vi.fn() }, "device-x");
    const url = new URL(lastCall()[0], "http://localhost");
    expect(url.pathname).toBe("/api/v1/reading-state/stream");
    expect(url.searchParams.get("bookId")).toBe("7");
    expect(url.searchParams.get("deviceId")).toBe("device-x");
  });

  it("拒收别的书或格式不对的变化消息，不触发重新拉取", () => {
    const onChange = vi.fn();
    openReadingStateStream(7, { onChange }, "device");
    const { message } = lastCall()[1];
    expect(() => message(changed({ bookId: 8, revision: 2, changed: ["annotations"] }))).toThrow("无效阅读状态事件");
    expect(() => message(changed({ bookId: 7, revision: "2", changed: ["annotations"] }))).toThrow("无效阅读状态事件");
    expect(() => message(changed({ bookId: 7, revision: 2 }))).toThrow("无效阅读状态事件");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("连接出错、重新拉取出错时都交给上层显示", async () => {
    const onError = vi.fn();
    const failure = new Error("拉取失败");
    openReadingStateStream(7, { onChange: vi.fn(async () => { throw failure; }), onError }, "device");
    const handlers = lastCall()[1];
    const disconnected = new Error("实时连接中断，正在重连");
    handlers.error(disconnected);
    handlers.message(changed({ bookId: 7, revision: 2, changed: ["annotations"] }));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(2));
    expect(onError).toHaveBeenNthCalledWith(1, disconnected);
    expect(onError).toHaveBeenNthCalledWith(2, failure);
  });
});
