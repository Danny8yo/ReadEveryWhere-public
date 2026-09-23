import { BookAnalysisWorker } from "./book-analysis.worker";

describe("BookAnalysisWorker", () => {
  it("以有限并发处理任务，单本失败不阻止同批其他书完成", async () => {
    let active = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    const claims = [1, 2, 3].map((bookId) => ({
      task: { id: `task-${bookId}`, userId: 7, bookId, status: "running" },
      lease: { taskId: `task-${bookId}`, workerId: "worker", leaseToken: `lease-${bookId}`, generation: 1 },
      resumed: false,
    }));
    const store = {
      claimNext: jest.fn(() => claims.shift() ?? null),
      complete: jest.fn(),
      fail: jest.fn(),
      releaseLease: jest.fn(),
    };
    const classify = {
      execute: jest.fn(async ({ bookId }: { bookId: number }) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => release.push(resolve));
        active -= 1;
        if (bookId === 2) throw Object.assign(new Error("timeout"), { code: "CLASSIFICATION_TIMEOUT" });
        return { id: `profile-${bookId}` };
      }),
    };
    const worker = new BookAnalysisWorker(store as never, classify as never, {
      concurrency: 2,
      leaseMs: 60_000,
      workerId: "worker",
    });

    const execution = worker.tick();
    await Promise.resolve();
    expect(active).toBe(2);
    expect(peak).toBe(2);
    release.splice(0).forEach((resolve) => resolve());
    while (release.length === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    release.splice(0).forEach((resolve) => resolve());
    await execution;

    expect(peak).toBe(2);
    expect(store.complete).toHaveBeenCalledTimes(2);
    expect(store.fail).toHaveBeenCalledWith(expect.objectContaining({ taskId: "task-2", errorCode: "CLASSIFICATION_TIMEOUT" }));
  });

  it("claim 到过期 running 任务时按恢复路径继续执行", async () => {
    const claim = {
      task: { id: "task-recovered", userId: 7, bookId: 42, status: "running" },
      lease: { taskId: "task-recovered", workerId: "worker", leaseToken: "lease", generation: 2 },
      resumed: true,
    };
    const store = {
      claimNext: jest.fn().mockReturnValueOnce(claim).mockReturnValue(null),
      complete: jest.fn(), fail: jest.fn(), releaseLease: jest.fn(),
    };
    const classify = { execute: jest.fn().mockResolvedValue({ id: "profile-1" }) };
    const worker = new BookAnalysisWorker(store as never, classify as never, {
      concurrency: 1, leaseMs: 60_000, workerId: "worker",
    });

    await worker.tick();

    expect(classify.execute).toHaveBeenCalledWith(expect.objectContaining({ bookId: 42 }));
    expect(store.complete).toHaveBeenCalledWith(expect.objectContaining({ taskId: "task-recovered", profileId: "profile-1" }));
  });

  it("SQLite 短暂锁竞争不终止轮询，下一次 tick 继续领取任务", async () => {
    const claim = {
      task: { id: "task-after-lock", userId: 7, bookId: 42, status: "running" },
      lease: { taskId: "task-after-lock", workerId: "worker", leaseToken: "lease", generation: 1 },
      resumed: false,
    };
    const locked = Object.assign(new Error("database is locked"), {
      code: "ERR_SQLITE_ERROR",
      errcode: 5,
      errstr: "database is locked",
    });
    const store = {
      claimNext: jest.fn()
        .mockImplementationOnce(() => { throw locked; })
        .mockReturnValueOnce(claim)
        .mockReturnValue(null),
      complete: jest.fn(), fail: jest.fn(), releaseLease: jest.fn(),
    };
    const classify = { execute: jest.fn().mockResolvedValue({ id: "profile-1" }) };
    const worker = new BookAnalysisWorker(store as never, classify as never, {
      concurrency: 1, leaseMs: 60_000, workerId: "worker",
    });
    const warning = jest.spyOn((worker as any).logger, "warn").mockImplementation(() => undefined);

    await expect(worker.tick()).resolves.toBeUndefined();
    await expect(worker.tick()).resolves.toBeUndefined();

    expect(warning).toHaveBeenCalledWith({
      event: "book_analysis.worker.sqlite_busy",
      errorCode: "SQLITE_BUSY",
    });
    expect(classify.execute).toHaveBeenCalledWith(expect.objectContaining({ bookId: 42 }));
    expect(store.complete).toHaveBeenCalledWith(expect.objectContaining({ taskId: "task-after-lock" }));
  });

  it("非锁竞争的领取错误仍向上传播", async () => {
    const store = {
      claimNext: jest.fn(() => { throw Object.assign(new Error("database disk image is malformed"), { code: "ERR_SQLITE_ERROR" }); }),
      complete: jest.fn(), fail: jest.fn(), releaseLease: jest.fn(),
    };
    const classify = { execute: jest.fn() };
    const worker = new BookAnalysisWorker(store as never, classify as never, {
      concurrency: 1, leaseMs: 60_000, workerId: "worker",
    });

    await expect(worker.tick()).rejects.toThrow("database disk image is malformed");
    expect(classify.execute).not.toHaveBeenCalled();
  });
});
