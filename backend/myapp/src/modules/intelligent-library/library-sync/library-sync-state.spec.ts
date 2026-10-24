import { Logger } from "@nestjs/common";
import { LibrarySyncState } from "./library-sync-state";

// 编号对应 doc/同步测试用例审查.md
describe("书架版本与推送分发（LibrarySyncState）", () => {
  let sync: LibrarySyncState;
  beforeEach(() => {
    jest.useFakeTimers();
    sync = new LibrarySyncState();
  });
  afterEach(() => {
    sync.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("B1 用户之间互不通知；每次变化版本号 +1，无人在线也累加；服务器重启后纪元改变", () => {
    const other = jest.fn();
    sync.subscribe(2, other, () => {});
    sync.changed(1);
    expect(sync.version(1).revision).toBe(1);
    expect(sync.version(2).revision).toBe(0);
    expect(other).not.toHaveBeenCalled();
    expect(new LibrarySyncState().version(1).epoch).not.toBe(
      sync.version(1).epoch,
    );
  });

  it("B2 一个连接推送失败不影响同用户其他连接；失败的连接被强制关闭以便重连核对", () => {
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => {});
    const closed = jest.fn(),
      healthy = jest.fn();
    sync.subscribe(
      1,
      () => {
        throw Error("socket");
      },
      closed,
    );
    sync.subscribe(1, healthy, () => {});
    expect(() => sync.changed(1)).not.toThrow();
    expect(sync.version(1).revision).toBe(1);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(1);
  });

  it("B3 下载进度每任务 500 毫秒最多推一次且只推最新值；纯进度不算书架变化；任务结束立即通知并丢弃未发出的进度", () => {
    const events = jest.fn();
    sync.subscribe(1, events, () => {});
    sync.progress({ userId: 1, bookId: 2, taskId: 3, progress: 10 });
    sync.progress({ userId: 1, bookId: 2, taskId: 3, progress: 20 });
    sync.progress({ userId: 1, bookId: 2, taskId: 3, progress: 30 });
    expect(sync.watermark(1)).toBe(3);
    expect(sync.version(1).revision).toBe(0);
    expect(events).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(500);
    expect(events).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sequence: 3, progress: 30 }),
      }),
    );
    sync.progress({ userId: 1, bookId: 2, taskId: 3, progress: 40 });
    sync.changed(1, 3);
    jest.advanceTimersByTime(500);
    expect(events).toHaveBeenCalledTimes(3);
    expect(events).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "library_changed" }),
    );
  });

  it("G15 书架变化通知带着最新版本号，与版本查询结果一致", () => {
    const events = jest.fn();
    sync.subscribe(1, events, () => {});
    sync.changed(1);
    sync.changed(1);
    expect(events).toHaveBeenLastCalledWith({
      name: "library_changed",
      data: { libraryVersion: sync.version(1) },
    });
    expect(sync.version(1).revision).toBe(2);
  });

  it("G16 客户端断开后取消订阅：不再收到推送，订阅表中不留残余", () => {
    const events = jest.fn();
    const unsubscribe = sync.subscribe(1, events, () => {});
    unsubscribe();
    sync.changed(1);
    expect(events).not.toHaveBeenCalled();
    // 残余条目只会体现为内存缓慢增长，无法从外部观察，这里直接检查内部订阅表。
    expect(
      (sync as unknown as { listeners: Map<number, unknown> }).listeners.size,
    ).toBe(0);
  });
});
