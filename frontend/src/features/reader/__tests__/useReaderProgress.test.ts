import { beforeEach, describe, expect, it, vi } from 'vitest';

const upsertProgress = vi.fn();
vi.mock('../api/progressApi', () => ({
  upsertProgress: (...a: unknown[]) => upsertProgress(...a),
}));

import { useReaderProgress } from '../web/useReaderProgress';

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
// D11～D13 编号对应 doc/同步测试用例审查.md
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

  it('D11 阅读进度上报失败时显示失败状态', async () => {
    upsertProgress.mockRejectedValue(new Error('network'));
    const p = useReaderProgress(BOOK);
    await p.pushRemote({ location: 'cfi-1', fraction: 0.2, locationType: 'epubcfi' });
    expect(p.syncStatus.value).toBe('failed');
    expect(p.lastError.value).toBeTruthy();
  });

  it('D12 每次上报进度，设备序号 +1 并保存，下次继续递增', async () => {
    upsertProgress.mockResolvedValue({ deviceSequence: 2, revision: 2 });
    const p = useReaderProgress(BOOK);
    await p.pushRemote({ location: 'cfi-1', fraction: 0.2, locationType: 'epubcfi' });
    await p.pushRemote({ location: 'cfi-2', fraction: 0.3, locationType: 'epubcfi' });
    expect(upsertProgress.mock.calls.map((call) => call[0].deviceSequence)).toEqual([1, 2]);
  });

  it('D13 先发的进度请求比后发的晚返回失败 → 状态保持"已同步"（最新位置已经保存）', async () => {
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
