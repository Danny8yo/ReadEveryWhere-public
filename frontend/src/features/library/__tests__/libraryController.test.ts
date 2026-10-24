import { describe, expect, it, vi } from 'vitest';
import { createLibraryController, createLibraryState, type LibraryGateway } from '../domain/library';
import type { LibraryBook, LibraryListResponse } from '../model/library';

const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((a) => { resolve = a; });
  return { resolve, promise };
};
const book = (id: number) => ({ id, userId: 1, title: '书', authors: [], version: 3 }) as unknown as LibraryBook;
const listed = (items: LibraryBook[], page = 1, total = items.length): LibraryListResponse =>
  ({ items, total, page, pageSize: 20 }) as LibraryListResponse;

function controllerWith(gateway: Partial<LibraryGateway<unknown>>) {
  const state = createLibraryState();
  const api = { invalidate: vi.fn(), clearBookFileCacheForBook: vi.fn(async () => {}), ...gateway } as unknown as LibraryGateway<unknown>;
  return { state, api, controller: createLibraryController(state, api) };
}

// 编号对应 doc/同步测试用例审查.md
describe('书架页面控制器', () => {
  it('N4 切换筛选后，旧查询迟到的列表不会覆盖新结果', async () => {
    const old = deferred<LibraryListResponse>();
    const fetch = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(listed([book(2)]));
    const { state, controller } = controllerWith({ fetchLibraryBooks: fetch });
    const first = controller.loadLibrary({ keyword: 'old' });
    await controller.loadLibrary({ keyword: 'new' });
    old.resolve(listed([book(1)]));
    await first;
    expect(state.books.map((b) => b.id)).toEqual([2]);
  });

  it('N2 后台刷新失败时保留已显示的列表，并记录错误供界面提示', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(listed([book(2)])).mockRejectedValueOnce({ message: 'network' });
    const { state, controller } = controllerWith({ fetchLibraryBooks: fetch });
    await controller.loadLibrary({});
    await expect(controller.loadLibrary({}, { silent: true })).rejects.toEqual({ message: 'network' });
    expect(state.books.map((b) => b.id)).toEqual([2]);
    expect(state.error).toBe('network');
  });

  it('N3 当前页码超出新的末页时转到末页', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ items: [], total: 21, page: 3, pageSize: 20 })
      .mockResolvedValueOnce({ items: [book(8)], total: 21, page: 2, pageSize: 20 });
    const { state, controller } = controllerWith({ fetchLibraryBooks: fetch });
    state.books = [book(7)];
    state.activeQuery = { page: 3, pageSize: 20 };
    await controller.loadLibrary();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(state.pagination.page).toBe(2);
    expect(state.loading).toBe(false);
    expect(state.books.map((b) => b.id)).toEqual([8]);
  });

  it('N3 自动刷新保留当前页码和筛选，新增书籍不会跳回第一页', async () => {
    const fetch = vi.fn(async (q: { page?: number }) => listed([book(q.page ?? 1)], q.page ?? 1, 60));
    const { state, controller } = controllerWith({ fetchLibraryBooks: fetch });
    await controller.loadLibrary({ page: 2, keyword: '三体' });
    await controller.loadLibrary({}, { silent: true });
    expect(fetch).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, keyword: '三体' }));
    expect(state.pagination.page).toBe(2);
  });

  it('N3 书库被删空时显示第一页的空状态', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ items: [], total: 0, page: 3, pageSize: 20 })
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
    const { state, controller } = controllerWith({ fetchLibraryBooks: fetch });
    state.books = [book(7)];
    state.activeQuery = { page: 3, pageSize: 20 };
    await controller.loadLibrary();
    expect(state.pagination).toMatchObject({ page: 1, totalPages: 1, total: 0 });
    expect(state.books).toEqual([]);
  });

  it.each([
    ['导入', (c: ReturnType<typeof createLibraryController>) => c.importBookFromFile({ file: 'f' }), 'importBook'],
    ['手动添加', (c: ReturnType<typeof createLibraryController>) => c.addBook({ title: 't' } as never), 'addBookManual'],
    ['删除', (c: ReturnType<typeof createLibraryController>) => c.deleteBooks([1]), 'deleteLibraryBook'],
    ['修改元数据', (c: ReturnType<typeof createLibraryController>) => c.updateBookMetadata(1, { title: 't' }), 'updateLibraryBook'],
  ] as const)('N6 %s成功或失败后，书架都会刷新', async (_label, action, method) => {
    const ok = controllerWith({ [method]: vi.fn(async () => ({ deleted: true, bookId: 1 })) });
    await action(ok.controller);
    expect(ok.api.invalidate).toHaveBeenCalledTimes(1);
    const failed = controllerWith({ [method]: vi.fn(async () => { throw new Error('写入结果不明'); }) });
    await expect(action(failed.controller)).rejects.toThrow();
    expect(failed.api.invalidate).toHaveBeenCalledTimes(1);
  });

  it('N7 写入成功但列表刷新失败 → 提示"操作成功，列表更新失败"，不误报为写入失败', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(listed([book(1)])).mockRejectedValueOnce(new Error('network'));
    const { state, controller } = controllerWith({
      fetchLibraryBooks: fetch,
      deleteLibraryBook: vi.fn(async () => ({ deleted: true, bookId: 1 })),
    });
    await controller.loadLibrary({});
    await controller.deleteBooks([1]);
    await controller.loadLibrary({}, { silent: true }).catch(() => undefined);
    expect(state.error).toContain('操作成功，列表更新失败');
  });
});
