// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLibrarySession } from '../web/librarySession';
import type { LibraryVersion, DownloadProgressEvent } from '../model/sync';

const transport = vi.hoisted(() => ({
  open: vi.fn(),
  state: vi.fn(),
  stop: vi.fn(),
  books: vi.fn(),
  identity: 'verified-session',
}));
vi.mock('../api/librarySyncApi', () => ({
  openLibraryStream: transport.open,
  getLibrarySyncState: transport.state,
}));
vi.mock('../api/libraryApi', () => ({ fetchLibraryBooks: transport.books }));
vi.mock('../../../shared/web/apiClient', () => ({
  getBaseUrl: () => 'http://library.test',
  getSessionVersion: () => transport.identity,
}));

type Handlers = {
  ready(version: LibraryVersion): void;
  change(version: LibraryVersion): void;
  progress(event: DownloadProgressEvent): void;
  error(error: unknown): void;
};

const version = (revision: number): LibraryVersion => ({ epoch: 'server', revision });
const page = (revision: number, items: unknown[] = [{ id: 7, userId: 7 }]) => ({
  items, total: items.length, page: 1, pageSize: 20, libraryVersion: version(revision), progressSequence: 0,
});

function setVisibility(value: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
}

// 测试中途失败时也要关闭会话，否则残留的窗口事件监听会干扰后续测试。
const sessions: Array<{ dispose(): void }> = [];

/** 打开书架同步会话，并拿到推送连接的回调，方便模拟服务器消息。 */
function openSession(verify = vi.fn(async () => true)) {
  let handlers!: Handlers;
  transport.open.mockImplementation((value: Handlers) => { handlers = value; return transport.stop; });
  const session = createLibrarySession(7, verify);
  sessions.push(session);
  return { session, handlers, verify };
}

/** 连接就绪并完成首次核对后的会话，书架页面处于可见状态。 */
async function readySession() {
  const opened = openSession();
  transport.state.mockResolvedValue(version(1));
  opened.handlers.ready(version(1));
  await opened.session.recover();
  opened.session.cache.activate({});
  opened.session.cache.setVisible(true);
  await opened.session.cache.read({});
  return opened;
}

beforeEach(() => {
  setVisibility('visible');
  transport.identity = 'verified-session';
  transport.books.mockImplementation(async () => page(1));
});
afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  vi.useRealTimers();
  vi.clearAllMocks();
});

// 编号对应 doc/同步测试用例审查.md
describe('书架同步会话', () => {
  it('B19 恢复核对进行中连接又断了 → 显示"重连中"；下次就绪并核对成功后才显示"已连接"', async () => {
    const { session, handlers } = openSession();
    let finishRecovery!: (version: LibraryVersion) => void;
    transport.state.mockImplementationOnce(() => new Promise<LibraryVersion>(resolve => { finishRecovery = resolve; }));
    try {
      handlers.ready(version(1));
      const recovery = session.recover();
      await Promise.resolve();
      expect(transport.state).toHaveBeenCalledTimes(1);
      handlers.error(new Error('连接已断开'));
      finishRecovery(version(1));
      await recovery;
      expect(session.status.connection).toBe('reconnecting');
      expect(session.status.error).toBe('连接已断开');

      transport.state.mockResolvedValueOnce(version(2));
      handlers.ready(version(2));
      await session.recover();
      expect(session.status.connection).toBe('connected');
      expect(session.status.error).toBeNull();
      expect(transport.state).toHaveBeenCalledTimes(2);
    } finally {
      session.dispose();
    }
    expect(transport.stop).toHaveBeenCalledOnce();
  });

  it('G1 收到"书架变了"推送 → 当前书架自动重新拉取', async () => {
    vi.useFakeTimers();
    const { session, handlers } = await readySession();
    transport.books.mockImplementation(async () => page(2, [{ id: 8, userId: 7 }]));
    handlers.change(version(2));
    await vi.advanceTimersByTimeAsync(1000);
    expect(transport.books).toHaveBeenCalledTimes(2);
    expect(session.cache.peek({})!.items[0]).toMatchObject({ id: 8 });
    session.dispose();
  });

  it('G1 收到下载进度推送 → 更新对应书的进度', async () => {
    const { session, handlers } = await readySession();
    transport.books.mockImplementation(async () => page(1));
    await session.cache.read({}, true);
    session.cache.updateBook(7, { downloadTaskId: 3, downloadStatus: 'downloading', downloadProgress: 10 } as never);
    handlers.progress({ epoch: 'server', sequence: 1, bookId: 7, taskId: 3, progress: 55 });
    expect(session.cache.peek({})!.items[0]).toMatchObject({ downloadProgress: 55 });
    session.dispose();
  });

  it('G2 登录身份变化后，旧会话收到的推送一律丢弃', async () => {
    vi.useFakeTimers();
    const { session, handlers } = await readySession();
    transport.identity = 'another-account';
    handlers.change(version(5));
    handlers.error(new Error('旧连接的错误'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(transport.books).toHaveBeenCalledTimes(1);
    expect(session.status.error).toBeNull();
    session.dispose();
  });

  it('G2 列表里出现不属于当前用户的书 → 拒收这份列表并报"登录身份已变化"', async () => {
    const { session } = openSession();
    transport.books.mockResolvedValueOnce(page(1, [{ id: 9, userId: 99 }]));
    await expect(session.cache.read({})).rejects.toThrow('登录身份已变化');
    expect(session.cache.peek({})).toBeUndefined();
    session.dispose();
  });

  it('G2 列表请求返回前登录身份已变化 → 丢弃这份列表', async () => {
    const { session } = openSession();
    let finish!: (value: unknown) => void;
    transport.books.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const reading = session.cache.read({});
    transport.identity = 'another-account';
    finish(page(1));
    await expect(reading).rejects.toThrow('登录身份已变化');
    session.dispose();
  });

  it.each([
    ['窗口重新获得焦点', () => window.dispatchEvent(new Event('focus'))],
    ['网络恢复', () => window.dispatchEvent(new Event('online'))],
    ['标签页回到前台', () => document.dispatchEvent(new Event('visibilitychange'))],
  ])('G4 %s → 主动向服务器核对一次版本', async (_label, trigger) => {
    const { session } = await readySession();
    transport.state.mockClear();
    trigger();
    await vi.waitFor(() => expect(transport.state).toHaveBeenCalledTimes(1));
    session.dispose();
  });

  it('G4 标签页在后台时不核对，回到前台再核对', async () => {
    const { session } = await readySession();
    transport.state.mockClear();
    setVisibility('hidden');
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
    expect(transport.state).not.toHaveBeenCalled();
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(transport.state).toHaveBeenCalledTimes(1));
    session.dispose();
  });

  it('N10 核对过程中连接重新就绪 → 本次核对结束后再补核对一次（不重复验证登录）', async () => {
    const { session, handlers, verify } = openSession();
    let finishFirst!: (version: LibraryVersion) => void;
    transport.state
      .mockImplementationOnce(() => new Promise<LibraryVersion>(resolve => { finishFirst = resolve; }))
      .mockResolvedValueOnce(version(2));
    handlers.ready(version(1));
    await Promise.resolve();
    handlers.ready(version(2));
    finishFirst(version(1));
    await vi.waitFor(() => expect(transport.state).toHaveBeenCalledTimes(2));
    expect(verify).toHaveBeenCalledTimes(1);
    session.dispose();
  });

  it('E8 断网很久后恢复，焦点、网络、前台事件同时触发 → 只核对一次', async () => {
    const { session } = await readySession();
    transport.state.mockClear();
    let finish!: (version: LibraryVersion) => void;
    transport.state.mockImplementationOnce(() => new Promise<LibraryVersion>(resolve => { finish = resolve; }));
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(transport.state).toHaveBeenCalledTimes(1));
    finish(version(9));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(transport.state).toHaveBeenCalledTimes(1);
    session.dispose();
  });
});
