import { describe, it, expect, vi } from "vitest";
import {
  createLibraryQueryCache,
  normalizeLibraryQuery,
} from "../features/library/domain/queryCache";
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
  it("normalizes absent filters and unordered formats", () => {
    expect(
      normalizeLibraryQuery({
        keyword: "  ",
        formats: ["epub", "pdf", "epub"],
      }),
    ).toEqual({ page: 1, pageSize: 20, formats: ["epub", "pdf"] });
  });
  it("keeps results until explicit invalidation without timer expiry", async () => {
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
  it("deduplicates in flight requests and preserves invalidation during flight", async () => {
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
  it("bounds cache and discards completed requests after identity disposal", async () => {
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
  it("HTTP discovering a newer revision invalidates other pages", async () => {
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
  it("rejects an old epoch response after a new connection", async () => {
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
  it("merges newer matching task progress over an in-flight snapshot", async () => {
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
  it("coalesces events, enforces one second starts and only one follow-up while in flight", async () => {
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
  it("does not fetch while hidden and catches up once activated", async () => {
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
  it("preserves cached data on failure and does not create an automatic retry loop", async () => {
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
