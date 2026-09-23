import { beforeEach, describe, expect, it, vi } from 'vitest';

const upsertProgress = vi.fn();
vi.mock('../features/reader/api/progressApi', () => ({
  upsertProgress: (...a: unknown[]) => upsertProgress(...a),
}));

import { useReaderProgress } from '../composables/reader/useReaderProgress';

// 简易 localStorage stub（node 环境无此全局）
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as any).localStorage = new MemStorage();
});

const BOOK = 42;
describe('useReaderProgress.resolveInitialPosition', () => {
  it('uses the authoritative snapshot supplied by reading-state sync', async () => {
    const remote = {
      id: 1,
      userId: 1,
      bookId: BOOK,
      bookHash: '',
      location: 'epubcfi(remote)',
      fraction: 0.5,
      locationType: 'epubcfi',
      deviceId: 'remote-device',
      deviceSequence: 2,
      revision: 2,
      createdAt: 1000,
      updatedAt: 2000,
    } as const;
    const p = useReaderProgress(BOOK);
    const pos = p.resolveInitialPosition(remote);
    expect(pos?.location).toBe('epubcfi(remote)');
    expect(pos?.fraction).toBe(0.5);
  });

  it('returns null when the server snapshot has no progress', () => {
    const p = useReaderProgress(BOOK);
    const pos = p.resolveInitialPosition(null);
    expect(pos).toBeNull();
  });

  it('exposes a failed status when an online write is rejected', async () => {
    upsertProgress.mockRejectedValue(new Error('network'));
    const p = useReaderProgress(BOOK);
    await p.pushRemote({ location: 'cfi-1', fraction: 0.2, locationType: 'epubcfi' });
    expect(p.syncStatus.value).toBe('failed');
    expect(p.lastError.value).toBeTruthy();
  });

  it('increments and persists a monotonic device sequence', async () => {
    upsertProgress.mockResolvedValue({ deviceSequence: 2, revision: 2 });
    const p = useReaderProgress(BOOK);
    await p.pushRemote({ location: 'cfi-1', fraction: 0.2, locationType: 'epubcfi' });
    await p.pushRemote({ location: 'cfi-2', fraction: 0.3, locationType: 'epubcfi' });
    expect(upsertProgress.mock.calls.map((call) => call[0].deviceSequence)).toEqual([1, 2]);
  });

  it('does not let an older request failure overwrite a newer confirmed status', async () => {
    let rejectFirst!: (reason: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    upsertProgress
      .mockReturnValueOnce(new Promise((_resolve, reject) => { rejectFirst = reject; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveSecond = resolve; }));
    const p = useReaderProgress(BOOK);

    const first = p.pushRemote({ location: 'cfi-1', fraction: 0.2, locationType: 'epubcfi' });
    const second = p.pushRemote({ location: 'cfi-2', fraction: 0.3, locationType: 'epubcfi' });
    resolveSecond({ deviceSequence: 2, revision: 2 });
    await second;
    rejectFirst(new Error('late failure'));
    await first;

    expect(p.syncStatus.value).toBe('synced');
    expect(p.lastError.value).toBeNull();
  });
});
