import { describe, expect, it, vi } from 'vitest';
import { createBookmarkController, createBookmarkState } from '../domain/bookmarkCommands';

function withBookmark(remove: (id: number) => Promise<{ deleted: boolean }>) {
  const state = createBookmarkState();
  state.bookmarks = [{ id: '5', cfi: 'cfi-5', fraction: 0.5 }];
  const controller = createBookmarkController(state, { create: vi.fn(), delete: remove });
  return { state, controller };
}

// 编号对应 doc/同步测试用例审查.md
describe('书签删除', () => {
  it('D2 删除书签成功 → 从列表中移除，状态为"已同步"', async () => {
    const { state, controller } = withBookmark(vi.fn(async () => ({ deleted: true })));
    await controller.remove('5');
    expect(state.bookmarks).toEqual([]);
    expect(state.syncStatus).toBe('synced');
  });

  it('D2 删除因断网失败 → 书签保留，状态为"失败"', async () => {
    const { state, controller } = withBookmark(vi.fn(async () => { throw new Error('network'); }));
    await controller.remove('5');
    expect(state.bookmarks).toHaveLength(1);
    expect(state.syncStatus).toBe('failed');
  });

  it('D2 重复删除（另一台设备已删掉）→ 服务器回复"书签不存在"，当作删除成功，界面不报错', async () => {
    const notFound = { code: 40401, message: 'Bookmark not found', details: { field: 'bookmark', reason: 'RESOURCE_NOT_FOUND' } };
    const { state, controller } = withBookmark(vi.fn(async () => { throw notFound; }));
    await controller.remove('5');
    expect(state.bookmarks).toEqual([]);
    expect(state.syncStatus).toBe('synced');
    expect(state.error).toBeNull();
  });
});
