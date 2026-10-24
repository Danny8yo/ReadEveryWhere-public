import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLibrarySyncState, openLibraryStream } from '../api/librarySyncApi';

const mocks = vi.hoisted(() => ({ open: vi.fn(() => () => {}), request: vi.fn() }));
vi.mock('../../../shared/web/sseTransport', () => ({ openCookieSse: mocks.open }));
vi.mock('../../../shared/web/apiClient', () => ({ request: mocks.request }));

type Message = { event?: string; data: string };

function open() {
  const handlers = { ready: vi.fn(), change: vi.fn(), progress: vi.fn(), error: vi.fn() };
  openLibraryStream(handlers);
  const transport = (mocks.open.mock.calls.at(-1) as unknown as [string, { message(m: Message): void }])[1];
  return { handlers, send: (event: string, data: unknown) => transport.message({ event, data: JSON.stringify(data) }) };
}

const valid = { epoch: 'server', revision: 3 };

beforeEach(() => vi.clearAllMocks());

// 编号对应 doc/同步测试用例审查.md
// 消息处理抛出的错误由公共连接层接住：报错并停止连接（见 sseTransport.test.ts 的 G5）。
describe('书架推送消息解析', () => {
  it('G5 合法的就绪、书架变化、下载进度消息交给对应处理', () => {
    const { handlers, send } = open();
    send('ready', { libraryVersion: valid });
    send('library_changed', { libraryVersion: { ...valid, revision: 4 } });
    send('download_progress', { epoch: 'server', sequence: 1, bookId: 7, taskId: 8, progress: 50 });
    expect(handlers.ready).toHaveBeenCalledWith(valid);
    expect(handlers.change).toHaveBeenCalledWith({ ...valid, revision: 4 });
    expect(handlers.progress).toHaveBeenCalledWith({ epoch: 'server', sequence: 1, bookId: 7, taskId: 8, progress: 50 });
  });

  it.each([
    ['缺少纪元', { revision: 1 }],
    ['纪元为空', { epoch: '', revision: 1 }],
    ['版本号为负数', { epoch: 'server', revision: -1 }],
    ['版本号为小数', { epoch: 'server', revision: 1.5 }],
    ['版本号是字符串', { epoch: 'server', revision: '2' }],
  ])('G5 版本号格式不对（%s）→ 报"请刷新页面"，不当作正常数据', (_label, libraryVersion) => {
    const { handlers, send } = open();
    expect(() => send('library_changed', { libraryVersion })).toThrow('请刷新页面');
    expect(() => send('ready', { libraryVersion })).toThrow('请刷新页面');
    expect(handlers.change).not.toHaveBeenCalled();
    expect(handlers.ready).not.toHaveBeenCalled();
  });

  it.each([
    ['进度超过 100', { progress: 101 }],
    ['进度为负数', { progress: -1 }],
    ['进度为小数', { progress: 12.5 }],
    ['书号为 0', { bookId: 0 }],
    ['任务号为 0', { taskId: 0 }],
    ['序号为负数', { sequence: -1 }],
    ['缺少纪元', { epoch: undefined }],
  ])('G5 下载进度格式不对（%s）→ 报错，不更新进度', (_label, override) => {
    const { handlers, send } = open();
    expect(() => send('download_progress', { epoch: 'server', sequence: 1, bookId: 7, taskId: 8, progress: 50, ...override })).toThrow('无效下载进度事件');
    expect(handlers.progress).not.toHaveBeenCalled();
  });

  it('G5 心跳和不认识的消息类型被忽略，不报错', () => {
    const { handlers, send } = open();
    expect(() => send('heartbeat', {})).not.toThrow();
    expect(() => send('something_new', {})).not.toThrow();
    expect(handlers.ready).not.toHaveBeenCalled();
    expect(handlers.change).not.toHaveBeenCalled();
    expect(handlers.progress).not.toHaveBeenCalled();
  });

  it('G5 版本查询接口返回格式不对 → 报"请刷新页面"', async () => {
    mocks.request.mockResolvedValueOnce({ libraryVersion: { epoch: 'server' } });
    await expect(getLibrarySyncState()).rejects.toThrow('请刷新页面');
    mocks.request.mockResolvedValueOnce({ libraryVersion: valid });
    await expect(getLibrarySyncState()).resolves.toEqual(valid);
  });
});
