import { describe, it, expect, vi } from "vitest";
import {
  createLibraryQueryCache,
  normalizeLibraryQuery,
} from "../domain/queryCache";
// 编号对应 doc/同步测试用例审查.md
const response = (page = 1) => ({ items: [], total: 40, page, pageSize: 20 });
function fixture() {
  let now = 0;
  const fetch = vi.fn(async (q) => response(q.page));
  const cache = createLibraryQueryCache(fetch, {
    now: () => now,
    schedule(fn, ms) {
      const timer = setTimeout(fn, ms);
      return () => clearTimeout(timer);
    },
  });
  return { cache, fetch, advance: (ms: number) => (now += ms) };
}
describe("library session cache", () => {
  it("B9 查询条件写法不同、意思相同（格式顺序不同、关键词全是空格）时算同一份缓存", () => {
    expect(
      normalizeLibraryQuery({
        keyword: "  ",
        formats: ["epub", "pdf", "epub"],
      }),
    ).toEqual({ page: 1, pageSize: 20, formats: ["epub", "pdf"] });
  });
  it("B10 书架列表缓存不会因为时间过去自动过期，只有明确作废才重新请求", async () => {
    const f = fixture();
    await f.cache.read({});
    await f.cache.read({ page: 1 });
    expect(f.fetch).toHaveBeenCalledTimes(1);
    f.advance(60000);
    expect(f.cache.peek({})).toBeDefined();
    await f.cache.read({});
    expect(f.fetch).toHaveBeenCalledTimes(1);
    f.cache.invalidate();
    await f.cache.read({});
    expect(f.fetch).toHaveBeenCalledTimes(2);
    f.cache.dispose();
  });
  it("B11 同一查询同时请求两次只发一次；请求进行中被作废，结束后再拉一次", async () => {
    let finish!: (x: ReturnType<typeof response>) => void;
    const fetch = vi.fn(
      () => new Promise<ReturnType<typeof response>>((r) => (finish = r)),
    );
    const cache = createLibraryQueryCache(fetch, {
      now: () => 0,
      schedule() {
        return () => {};
      },
    });
    const a = cache.read({});
    const b = cache.read({});
    cache.invalidate();
    finish(response());
    await Promise.all([a, b]);
    const c = cache.read({});
    expect(fetch).toHaveBeenCalledTimes(2);
    finish(response());
    await c;
    cache.dispose();
  });
  it("B12 最多暂存 20 种查询结果，正在看的那一页不被扔掉；会话结束后暂存全部作废", async () => {
    const f = fixture();
    f.cache.activate({ page: 1 });
    for (let page = 1; page < 25; page++) await f.cache.read({ page });
    expect(f.cache.size).toBe(20);
    expect(f.cache.peek({ page: 1 })).toBeDefined();
    f.cache.dispose();
    await expect(f.cache.read({})).rejects.toThrow();
  });
});
describe("library realtime ordering", () => {
  const snapshot = (revision: number, page = 1, epoch = "a") => ({
    ...response(page),
    libraryVersion: { epoch, revision },
    progressSequence: 0,
  });
  it("B13 拉第 2 页时发现版本变新 → 第 1 页缓存也作废重拉", async () => {
    let revision = 1;
    const fetch = vi.fn(async (q) => snapshot(revision, q.page));
    const cache = createLibraryQueryCache(fetch, {
      now: () => 0,
      schedule: () => () => {},
    });
    await cache.read({ page: 1 });
    revision = 2;
    await cache.read({ page: 2 });
    await cache.read({ page: 1 });
    expect(fetch).toHaveBeenCalledTimes(3);
    cache.dispose();
  });
  it("B14 服务器重启前发出的列表请求，返回的旧数据被丢弃", async () => {
    let finish!: (value: ReturnType<typeof snapshot>) => void;
    const cache = createLibraryQueryCache(
      () => new Promise((r) => (finish = r)),
      { now: () => 0, schedule: () => () => {} },
    );
    cache.observeVersion({ epoch: "a", revision: 2 });
    const request = cache.read({});
    cache.observeVersion({ epoch: "b", revision: 0 });
    finish(snapshot(3));
    await expect(request).rejects.toThrow("旧服务器");
    expect(cache.peek({})).toBeUndefined();
    cache.dispose();
  });
  it("B15 列表请求途中收到更新的进度推送 → 显示推送的进度；别的下载任务的进度不改到这本书上", async () => {
    let finish!: (value: any) => void;
    const cache = createLibraryQueryCache(
      () => new Promise((r) => (finish = r)),
      { now: () => 0, schedule: () => () => {} },
    );
    cache.observeVersion({ epoch: "a", revision: 1 });
    const request = cache.read({});
    cache.applyProgress({
      epoch: "a",
      sequence: 2,
      bookId: 7,
      taskId: 8,
      progress: 75,
    });
    finish({
      ...snapshot(1),
      items: [
        {
          id: 7,
          downloadTaskId: 8,
          downloadProgress: 20,
          downloadStatus: "downloading",
        },
      ],
    });
    expect((await request).items[0].downloadProgress).toBe(75);
    cache.applyProgress({
      epoch: "a",
      sequence: 3,
      bookId: 7,
      taskId: 9,
      progress: 5,
    });
    expect(cache.peek({})!.items[0].downloadProgress).toBe(75);
    cache.dispose();
  });
});
describe("automatic refresh scheduling", () => {
  function timed(fetch: (q: any) => Promise<any>) {
    return createLibraryQueryCache(fetch, {
      now: Date.now,
      schedule(fn, ms) {
        const id = setTimeout(fn, ms);
        return () => clearTimeout(id);
      },
    });
  }
  it("B16 第一次变化立即拉；之后至少间隔 1 秒，期间的变化合并；拉取中再来变化只补拉一次", async () => {
    vi.useFakeTimers();
    const pending: Array<(value: any) => void> = [];
    const fetch = vi.fn(() => new Promise((r) => pending.push(r)));
    const cache = timed(fetch);
    cache.activate({});
    cache.setVisible(true);
    const first = cache.read({});
    cache.invalidate();
    cache.invalidate();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetch).toHaveBeenCalledTimes(1);
    pending.shift()!(response());
    await first;
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    pending.shift()!(response());
    await vi.advanceTimersByTimeAsync(0);
    cache.invalidate();
    cache.invalidate();
    await vi.advanceTimersByTimeAsync(999);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(3);
    pending.shift()!(response());
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetch).toHaveBeenCalledTimes(3);
    cache.dispose();
    vi.useRealTimers();
  });
  it("B17 书架不可见时收到变化不请求，回到书架后补拉一次", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => response());
    const cache = timed(fetch);
    cache.activate({});
    await cache.read({});
    cache.setVisible(false);
    cache.invalidate();
    cache.invalidate();
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetch).toHaveBeenCalledTimes(1);
    cache.setVisible(true);
    cache.revalidate();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    cache.dispose();
    vi.useRealTimers();
  });
  it("B18 自动刷新失败时保留旧列表，不自动无限重试", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => response());
    const cache = timed(fetch);
    cache.activate({});
    cache.setVisible(true);
    await cache.read({});
    const result = cache.peek({});
    fetch.mockRejectedValue(new Error("network"));
    cache.invalidate();
    await vi.advanceTimersByTimeAsync(60000);
    expect(cache.peek({})).toBe(result);
    expect(fetch).toHaveBeenCalledTimes(2);
    cache.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});

describe("书架缓存的同步行为（第 2 批补充）", () => {
  const book = (overrides: Record<string, unknown> = {}) => ({
    id: 7,
    downloadTaskId: 8,
    downloadProgress: 20,
    downloadStatus: "downloading",
    ...overrides,
  });
  const listed = (revision: number, items: unknown[] = [book()], progressSequence = 0) => ({
    items,
    total: items.length,
    page: 1,
    pageSize: 20,
    libraryVersion: { epoch: "a", revision },
    progressSequence,
  });
  function timedCache(fetch: (q: any) => Promise<any>) {
    return createLibraryQueryCache(fetch, {
      now: Date.now,
      schedule(fn, ms) {
        const id = setTimeout(fn, ms);
        return () => clearTimeout(id);
      },
    });
  }
  const progressOf = (cache: ReturnType<typeof timedCache>) =>
    (cache.peek({})!.items[0] as { downloadProgress: number }).downloadProgress;

  it("G1 收到更高的版本号 → 当前可见的书架自动重新拉取，并把新列表交给界面", async () => {
    vi.useFakeTimers();
    let revision = 1;
    const fetch = vi.fn(async () => listed(revision, [book({ id: revision })]));
    const cache = timedCache(fetch);
    const shown = vi.fn();
    cache.subscribe(shown);
    cache.activate({});
    cache.setVisible(true);
    await cache.read({});
    revision = 2;
    cache.observeVersion({ epoch: "a", revision: 2 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(shown).toHaveBeenLastCalledWith(
      expect.objectContaining({ items: [expect.objectContaining({ id: 2 })] }),
      null,
    );
    cache.dispose();
    vi.useRealTimers();
  });

  it("E1 同一条书架变化消息重复到达 → 只刷新一次；与当前版本相同的消息不触发刷新", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => listed(2));
    const cache = timedCache(fetch);
    cache.activate({});
    cache.setVisible(true);
    cache.observeVersion({ epoch: "a", revision: 1 });
    await cache.read({});
    cache.observeVersion({ epoch: "a", revision: 2 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetch).toHaveBeenCalledTimes(1);
    cache.observeVersion({ epoch: "a", revision: 3 });
    cache.observeVersion({ epoch: "a", revision: 3 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetch).toHaveBeenCalledTimes(2);
    cache.observeVersion({ epoch: "a", revision: 3 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledTimes(2);
    cache.dispose();
    vi.useRealTimers();
  });

  it("G3 进度只增不减：序号更旧的进度推送不会覆盖已显示的进度", async () => {
    const cache = timedCache(async () => listed(1));
    cache.observeVersion({ epoch: "a", revision: 1 });
    await cache.read({});
    cache.applyProgress({ epoch: "a", sequence: 3, bookId: 7, taskId: 8, progress: 60 });
    cache.applyProgress({ epoch: "a", sequence: 2, bookId: 7, taskId: 8, progress: 40 });
    expect(progressOf(cache)).toBe(60);
    cache.dispose();
  });

  it("G3 进度只更新对应的书：别的书的进度推送不会改到这本书上", async () => {
    const cache = timedCache(async () => listed(1, [book(), book({ id: 9, downloadTaskId: 10, downloadProgress: 5 })]));
    cache.observeVersion({ epoch: "a", revision: 1 });
    await cache.read({});
    cache.applyProgress({ epoch: "a", sequence: 1, bookId: 9, taskId: 10, progress: 90 });
    const [first, second] = cache.peek({})!.items as Array<{ downloadProgress: number }>;
    expect(first!.downloadProgress).toBe(20);
    expect(second!.downloadProgress).toBe(90);
    cache.dispose();
  });

  it("G3 下载已失败或已取消的书，不再接受进度推送", async () => {
    for (const status of ["failed", "canceled"]) {
      const cache = timedCache(async () => listed(1, [book({ downloadStatus: status })]));
      cache.observeVersion({ epoch: "a", revision: 1 });
      await cache.read({});
      cache.applyProgress({ epoch: "a", sequence: 1, bookId: 7, taskId: 8, progress: 80 });
      expect(progressOf(cache)).toBe(20);
      cache.dispose();
    }
  });

  it("E4 下载完成之后才到的迟到进度（99%）被忽略，保持\"已完成\"", async () => {
    const cache = timedCache(async () => listed(1, [book({ downloadStatus: "completed", downloadProgress: 100 })]));
    cache.observeVersion({ epoch: "a", revision: 1 });
    await cache.read({});
    cache.applyProgress({ epoch: "a", sequence: 5, bookId: 7, taskId: 8, progress: 99 });
    expect(cache.peek({})!.items[0]).toMatchObject({ downloadStatus: "completed", downloadProgress: 100 });
    cache.dispose();
  });

  it("E11 进度恰好为 0% 时正常显示；到 100% 时仍是\"下载中\"，等完成状态到达才变为完成", async () => {
    const cache = timedCache(async () => listed(1, [book({ downloadProgress: 30 })]));
    cache.observeVersion({ epoch: "a", revision: 1 });
    await cache.read({});
    cache.applyProgress({ epoch: "a", sequence: 1, bookId: 7, taskId: 8, progress: 0 });
    expect(progressOf(cache)).toBe(0);
    cache.applyProgress({ epoch: "a", sequence: 2, bookId: 7, taskId: 8, progress: 100 });
    expect(cache.peek({})!.items[0]).toMatchObject({ downloadProgress: 100, downloadStatus: "downloading" });
    cache.dispose();
  });

  it("N5 用户主动翻页或刷新时立即请求，不受 1 秒间隔限制", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async (q: { page?: number }) => ({ ...listed(1), page: q.page ?? 1 }));
    const cache = timedCache(fetch);
    cache.activate({});
    cache.setVisible(true);
    await cache.read({});
    const page2 = cache.read({ page: 2 });
    expect(fetch).toHaveBeenCalledTimes(2);
    await page2;
    const forced = cache.read({ page: 2 }, true);
    expect(fetch).toHaveBeenCalledTimes(3);
    await forced;
    cache.dispose();
    vi.useRealTimers();
  });
});
