import { AiReadingScheduler } from './ai-reading-scheduler';

describe('AiReadingScheduler', () => {
  it('waits for cancelled executions to finish persistence before shutdown returns', async () => {
    let finish!: () => void;
    let signal!: AbortSignal;
    const runs = {
      resumeReadyParents: jest.fn(),
      claimNext: jest.fn()
        .mockReturnValueOnce({ run: { id: 'drain', taskId: 'task' }, lease: lease('drain') })
        .mockReturnValue(null),
      renewLease: jest.fn(),
    };
    const executor = { execute: jest.fn((context: { signal: AbortSignal }) => {
      signal = context.signal;
      return new Promise<void>(resolve => { finish = resolve; });
    }) };
    const scheduler = new AiReadingScheduler(runs as never, executor as never, { maxConcurrentRuns: 1 });
    await scheduler.tick();
    let closed = false;
    const closing = scheduler.onModuleDestroy().then(() => { closed = true; });
    await flush();
    expect(signal.aborted).toBe(true);
    expect(closed).toBe(false);
    const claimsBeforeDrain = runs.claimNext.mock.calls.length;
    finish();
    await closing;
    await flush();
    expect(closed).toBe(true);
    expect(runs.claimNext).toHaveBeenCalledTimes(claimsBeforeDrain);
  });

  it('cleans up a synchronously failing executor and frees its slot', async () => {
    const runs = {
      resumeReadyParents: jest.fn(),
      claimNext: jest.fn()
        .mockReturnValueOnce({ run: { id: 'first', taskId: 'task' }, lease: lease('first') })
        .mockReturnValueOnce({ run: { id: 'next', taskId: 'task' }, lease: lease('next') })
        .mockReturnValue(null),
      renewLease: jest.fn(),
    };
    const executor = { execute: jest.fn()
      .mockImplementationOnce(() => { throw new Error('synchronous failure'); })
      .mockResolvedValue(undefined) };
    const scheduler = new AiReadingScheduler(runs as never, executor as never, { maxConcurrentRuns: 1 });
    await scheduler.tick();
    await flush();
    expect(executor.execute).toHaveBeenCalledTimes(2);
    await expect(scheduler.onModuleDestroy()).resolves.toBeUndefined();
  });

  it('runs at most four claimed AgentRuns and fills a freed slot', async () => {
    const claims = Array.from({ length: 5 }, (_, index) => ({
      run: { id: `run-${index + 1}` },
      lease: { agentRunId: `run-${index + 1}`, workerId: 'worker', leaseToken: `lease-${index}`,
        generation: 1, expiresAt: '2099-01-01T00:01:00.000Z' },
    }));
    const runs = {
      resumeReadyParents: jest.fn(),
      claimNext: jest.fn().mockImplementation(() => claims.shift() ?? null),
      renewLease: jest.fn(),
    };
    const resolvers = new Map<string, () => void>();
    let active = 0;
    let peak = 0;
    const executor = { execute: jest.fn(({ run }: { run: { id: string } }) => new Promise<void>((resolve) => {
      active += 1;
      peak = Math.max(peak, active);
      resolvers.set(run.id, () => { active -= 1; resolve(); });
    })) };
    const scheduler = new AiReadingScheduler(runs as never, executor as never, { maxConcurrentRuns: 4 });

    await scheduler.tick();
    expect(executor.execute).toHaveBeenCalledTimes(4);
    expect(peak).toBe(4);
    resolvers.get('run-1')!();
    await flush();
    expect(executor.execute).toHaveBeenCalledTimes(5);
    expect(peak).toBe(4);
    for (const resolve of resolvers.values()) resolve();
    await flush();
  });

  it('does not duplicate an active run across repeated ticks and resumes ready parents first', async () => {
    let resolve!: () => void;
    const claim = {
      run: { id: 'run-1' },
      lease: { agentRunId: 'run-1', workerId: 'worker', leaseToken: 'lease', generation: 1,
        expiresAt: '2099-01-01T00:01:00.000Z' },
    };
    const runs = {
      resumeReadyParents: jest.fn(),
      claimNext: jest.fn().mockReturnValueOnce(claim).mockReturnValue(null),
      renewLease: jest.fn(),
    };
    const executor = { execute: jest.fn(() => new Promise<void>((done) => { resolve = done; })) };
    const scheduler = new AiReadingScheduler(runs as never, executor as never, {
      maxConcurrentRuns: 4,
    });

    await Promise.all([scheduler.tick(), scheduler.tick(), scheduler.tick()]);

    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(runs.resumeReadyParents).toHaveBeenCalledTimes(3);
    resolve();
    await flush();
  });

  it('excludes in-process active runs when claiming the next queued step', async () => {
    let resolve!: () => void;
    let issuedLeases = 0;
    const claim = {
      run: { id: 'run-1', taskId: 'task-1' },
      lease: { agentRunId: 'run-1', workerId: 'worker', leaseToken: 'lease', generation: 1,
        expiresAt: '2099-01-01T00:01:00.000Z' },
    };
    const runs = {
      resumeReadyParents: jest.fn(),
      claimNext: jest.fn((_: string, __: string, ___: number, excludedRunIds: string[] = []) => {
        if (excludedRunIds.includes('run-1')) return null;
        issuedLeases += 1;
        return claim;
      }),
      renewLease: jest.fn(),
    };
    const executor = { execute: jest.fn(() => new Promise<void>((done) => { resolve = done; })) };
    const scheduler = new AiReadingScheduler(runs as never, executor as never, { maxConcurrentRuns: 4 });

    await scheduler.tick();

    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(issuedLeases).toBe(1);
    expect(runs.claimNext).toHaveBeenLastCalledWith(
      expect.any(String), expect.any(String), 4, ['run-1'],
    );
    resolve();
    await flush();
  });

  it('aborts every active node belonging to a cancelled task', async () => {
    let observedSignal: AbortSignal | undefined;
    const runs = {
      resumeReadyParents: jest.fn(),
      claimNext: jest.fn()
        .mockReturnValueOnce({ run: { id: 'run-1', taskId: 'task-1' }, lease: lease('run-1') })
        .mockReturnValueOnce({ run: { id: 'run-2', taskId: 'task-2' }, lease: lease('run-2') })
        .mockReturnValue(null),
      renewLease: jest.fn(),
    };
    const executor = { execute: jest.fn(({ run, signal }: { run: { id: string }; signal: AbortSignal }) => {
      if (run.id === 'run-1') observedSignal = signal;
      return new Promise<void>(() => undefined);
    }) };
    const scheduler = new AiReadingScheduler(runs as never, executor as never, { maxConcurrentRuns: 4 });
    await scheduler.tick();

    scheduler.abortTask('task-1');

    expect(observedSignal?.aborted).toBe(true);
  });

  it('treats a transient SQLite lock as a recoverable polling tick', async () => {
    const locked = Object.assign(new Error('database is locked'), {
      code: 'ERR_SQLITE_ERROR',
      errcode: 5,
      errstr: 'database is locked',
    });
    const runs = {
      resumeReadyParents: jest.fn()
        .mockImplementationOnce(() => { throw locked; })
        .mockReturnValue(0),
      claimNext: jest.fn().mockReturnValue(null),
    };
    const scheduler = new AiReadingScheduler(
      runs as never,
      { execute: jest.fn() } as never,
      { maxConcurrentRuns: 1 },
    );

    await expect(scheduler.tick()).resolves.toBeUndefined();
    expect(runs.claimNext).not.toHaveBeenCalled();

    await expect(scheduler.tick()).resolves.toBeUndefined();
    expect(runs.claimNext).toHaveBeenCalledTimes(1);
  });
});

function lease(agentRunId: string) {
  return { agentRunId, workerId: 'worker', leaseToken: `lease-${agentRunId}`, generation: 1,
    expiresAt: '2099-01-01T00:01:00.000Z' };
}

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}
