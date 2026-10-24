import { beforeEach, describe, expect, it, vi } from 'vitest';

const getReadingState = vi.fn();
const openReadingStateStream = vi.fn();
let focusHandler: (() => void) | undefined;
const stopStream = vi.fn();
vi.mock('../api/readingStateApi', () => ({
  getReadingState: (...args: unknown[]) => getReadingState(...args),
  openReadingStateStream: (...args: unknown[]) => openReadingStateStream(...args),
}));

import { useReadingStateSync } from '../web/useReadingStateSync';

// 编号对应 doc/同步测试用例审查.md
describe('useReadingStateSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 清掉上一个测试没用完的 mockResolvedValueOnce 队列，避免测试之间互相干扰。
    getReadingState.mockReset();
    openReadingStateStream.mockReset();
    (globalThis as any).window = {
      addEventListener: vi.fn((type: string, handler: () => void) => {
        if (type === 'focus') focusHandler = handler;
      }),
      removeEventListener: vi.fn(),
    };
    (globalThis as any).localStorage = {
      getItem: vi.fn().mockReturnValue('test-device'),
      setItem: vi.fn(),
    };
    getReadingState.mockResolvedValue({ revision: 1, progress: null, bookmarks: [], annotations: [] });
    focusHandler = undefined;
    openReadingStateStream.mockReturnValue(stopStream);
  });

  it('C11 收到更新的版本号 → 重新拉快照，界面随之更新', async () => {
    const sync = useReadingStateSync(42);
    await sync.start();
    expect(sync.snapshot.value?.revision).toBe(1);

    getReadingState.mockResolvedValue({ revision: 2, progress: null, bookmarks: [{ id: 1 }], annotations: [] });
    const handlers = openReadingStateStream.mock.calls[0][1];
    await handlers.onChange({ bookId: 42, revision: 2, changed: ['bookmarks'] });

    expect(sync.snapshot.value?.revision).toBe(2);
    expect(sync.snapshot.value?.bookmarks).toHaveLength(1);
    sync.dispose();
  });

  it('C12 收到已经拿过的版本号 → 不重复请求', async () => {
    const sync = useReadingStateSync(42);
    await sync.start();
    const handlers = openReadingStateStream.mock.calls[0][1];
    await handlers.onChange({ bookId: 42, revision: 1, changed: ['progress'] });
    expect(getReadingState).toHaveBeenCalledTimes(1);
    sync.dispose();
  });

  it('C13 断线变为"重连中"；重连后自动拉快照；窗口重新获得焦点时也拉', async () => {
    const sync = useReadingStateSync(42);
    await sync.start();
    const handlers = openReadingStateStream.mock.calls[0][1];
    handlers.onError(new Error('disconnected'));
    expect(sync.connectionStatus.value).toBe('reconnecting');

    getReadingState.mockResolvedValue({ revision: 2, progress: null, bookmarks: [], annotations: [] });
    await handlers.onOpen();
    expect(sync.connectionStatus.value).toBe('connected');
    expect(sync.snapshot.value?.revision).toBe(2);

    getReadingState.mockResolvedValue({ revision: 3, progress: null, bookmarks: [], annotations: [] });
    focusHandler?.();
    await vi.waitFor(() => expect(sync.snapshot.value?.revision).toBe(3));
    sync.dispose();
  });

  it('C14 服务器返回比手上更旧的快照 → 不覆盖', async () => {
    const sync = useReadingStateSync(42);
    await sync.start();
    getReadingState.mockResolvedValue({ revision: 0, progress: null, bookmarks: [{ id: 9 }], annotations: [] });
    await sync.refresh();
    expect(sync.snapshot.value).toMatchObject({ revision: 1, bookmarks: [] });
    sync.dispose();
  });

  it('C15 关闭阅读器 → 断开连接、移除焦点监听、状态复位', async () => {
    const sync = useReadingStateSync(42);
    await sync.start();
    sync.dispose();
    expect(stopStream).toHaveBeenCalledTimes(1);
    expect(window.removeEventListener).toHaveBeenCalledWith('focus', expect.any(Function));
    expect(sync.connectionStatus.value).toBe('idle');
  });

  it('G7 拉快照过程中又来新变化 → 本次拉完后再补拉一次，两次变化最终都显示', async () => {
    const sync = useReadingStateSync(42);
    await sync.start();
    const handlers = openReadingStateStream.mock.calls[0][1];
    let finishFirst!: (value: unknown) => void;
    getReadingState
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
      .mockResolvedValueOnce({ revision: 3, progress: null, bookmarks: [], annotations: [{ id: 'a' }, { id: 'b' }] });
    const first = handlers.onChange({ bookId: 42, revision: 2, changed: ['annotations'] });
    void handlers.onChange({ bookId: 42, revision: 3, changed: ['annotations'] });
    finishFirst({ revision: 2, progress: null, bookmarks: [], annotations: [{ id: 'a' }] });
    await first;
    await vi.waitFor(() => expect(sync.snapshot.value?.revision).toBe(3));
    expect(sync.snapshot.value?.annotations).toHaveLength(2);
    expect(getReadingState).toHaveBeenCalledTimes(3);
    sync.dispose();
  });

  it('G9 重新拉快照失败 → 状态为"同步失败"并保留错误，手上的快照不被清空', async () => {
    const sync = useReadingStateSync(42);
    await sync.start();
    const failure = new Error('network');
    getReadingState.mockRejectedValueOnce(failure);
    await expect(sync.refresh()).rejects.toBe(failure);
    expect(sync.syncStatus.value).toBe('failed');
    expect(sync.lastError.value).toBe(failure);
    expect(sync.snapshot.value?.revision).toBe(1);
    sync.dispose();
  });

  it('G10 关闭阅读器后才返回的快照被忽略', async () => {
    const sync = useReadingStateSync(42);
    await sync.start();
    let finish!: (value: unknown) => void;
    getReadingState.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const late = sync.refresh();
    sync.dispose();
    finish({ revision: 9, progress: null, bookmarks: [{ id: 1 }], annotations: [] });
    await expect(late).rejects.toThrow('阅读状态会话已结束');
    expect(sync.snapshot.value?.revision).toBe(1);
  });

  it('E2 笔记消息乱序：先到版本 5 再到版本 4 → 版本 4 被忽略，不重新拉取', async () => {
    const sync = useReadingStateSync(42);
    await sync.start();
    const handlers = openReadingStateStream.mock.calls[0][1];
    getReadingState.mockResolvedValueOnce({ revision: 5, progress: null, bookmarks: [], annotations: [] });
    await handlers.onChange({ bookId: 42, revision: 5, changed: ['annotations'] });
    await handlers.onChange({ bookId: 42, revision: 4, changed: ['annotations'] });
    expect(getReadingState).toHaveBeenCalledTimes(2);
    expect(sync.snapshot.value?.revision).toBe(5);
    sync.dispose();
  });
});
