import { beforeEach, describe, expect, it, vi } from 'vitest';

const createAnnotation = vi.fn();
const updateAnnotation = vi.fn();
const deleteAnnotation = vi.fn();
vi.mock('../api/annotationApi', () => ({
  createAnnotation: (...args: unknown[]) => createAnnotation(...args),
  updateAnnotation: (...args: unknown[]) => updateAnnotation(...args),
  deleteAnnotation: (...args: unknown[]) => deleteAnnotation(...args),
}));

import { useAnnotations } from '../web/useAnnotations';
import type {Annotation} from '../model/annotation';

const annotation = (revision = 1, note: string | null = null): Annotation => ({
  id: 'a1', userId: 1, bookId: 42, bookHash: 'hash', annotationType: 'highlight',
  color: '#ffeb3b', location: 'cfi-1', locationType: 'epubcfi', textContent: 'text',
  contextBefore: null, contextAfter: null, chapterLabel: null, sectionIndex: 0,
  textPositionStart: null, textPositionEnd: null, sortKey: 1, note,
  createdAt: 1, updatedAt: revision, revision,
});

// 编号对应 doc/同步测试用例审查.md；"冲突表"指第 6 节的笔记冲突处理表
describe('useAnnotations online synchronization', () => {
  beforeEach(() => vi.clearAllMocks());

  it('D7 修改笔记时带上当前版本号；服务器确认前界面不变，确认后才显示新内容', async () => {
    let resolveRequest!: (value: Annotation) => void;
    updateAnnotation.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve; }));
    const state = useAnnotations(42);
    state.replaceAnnotations([annotation()]);

    const pending = state.updateAnnotation('a1', { note: 'client' });
    expect(state.annotations.value[0].note).toBeNull();
    expect(updateAnnotation).toHaveBeenCalledWith('a1', { revision: 1, note: 'client' });

    resolveRequest(annotation(2, 'client'));
    await pending;
    expect(state.annotations.value[0]).toMatchObject({ note: 'client', revision: 2 });
  });

  it('D8 修改批注文字遇到冲突：显示服务器版本，保留你的编辑稿，状态为"冲突"', async () => {
    updateAnnotation.mockRejectedValue({
      details: { reason: 'ANNOTATION_CONFLICT', current: annotation(2, 'server') },
    });
    const state = useAnnotations(42);
    state.replaceAnnotations([annotation()]);

    await state.updateAnnotation('a1', { note: 'client' });
    expect(state.annotations.value[0].note).toBeNull();
    expect(state.conflict.value).toMatchObject({
      current: { revision: 2, note: 'server' },
      attempted: { kind: 'update', edits: { note: 'client' } },
    });
    expect(state.syncStatus.value).toBe('conflict');
  });

  it('D10 删除笔记因断网失败：笔记不从界面消失，状态为"失败"', async () => {
    deleteAnnotation.mockRejectedValue(new Error('network'));
    const state = useAnnotations(42);
    state.replaceAnnotations([annotation()]);
    expect(await state.deleteAnnotation('a1')).toBe(false);
    expect(state.annotations.value).toHaveLength(1);
    expect(state.syncStatus.value).toBe('failed');
  });

  it('D9 冲突后选"重新编辑"：界面换成服务器版本，编辑稿保留供继续修改', async () => {
    updateAnnotation.mockRejectedValue({
      details: { reason: 'ANNOTATION_CONFLICT', current: annotation(2, 'server') },
    });
    const state = useAnnotations(42);
    state.replaceAnnotations([annotation()]);

    await state.updateAnnotation('a1', { note: 'client' });
    const pending = state.prepareConflictRetry();

    expect(pending).toMatchObject({
      current: { revision: 2, note: 'server' },
      attempted: { kind: 'update', edits: { note: 'client' } },
    });
    expect(state.annotations.value[0]).toMatchObject({ revision: 2, note: 'server' });
    expect(state.conflict.value).toBeNull();
    expect(updateAnnotation).toHaveBeenCalledTimes(1);
  });

  const conflictWith = (current: Annotation) => ({ details: { reason: 'ANNOTATION_CONFLICT', current } });

  it('冲突表·改样式：改颜色或类型遇到冲突 → 显示服务器版本，保留你想要的样式，状态为"冲突"', async () => {
    const server = { ...annotation(2), color: '#2196f3' };
    updateAnnotation.mockRejectedValue(conflictWith(server));
    const state = useAnnotations(42);
    state.replaceAnnotations([annotation()]);
    await state.updateAnnotation('a1', { color: '#e53935', annotationType: 'underline' });
    expect(state.annotations.value[0]).toMatchObject({ color: '#ffeb3b', annotationType: 'highlight' });
    expect(state.conflict.value).toMatchObject({
      current: { revision: 2, color: '#2196f3' },
      attempted: { kind: 'update', edits: { color: '#e53935', annotationType: 'underline' } },
    });
    expect(state.syncStatus.value).toBe('conflict');
    const retry = state.prepareConflictRetry();
    expect(retry?.attempted).toEqual({ kind: 'update', edits: { color: '#e53935', annotationType: 'underline' } });
    expect(state.annotations.value[0]).toMatchObject({ revision: 2, color: '#2196f3' });
  });

  it('冲突表·删除：删除时对方刚改过 → 不删，显示服务器版本，状态为"冲突"，可再次删除', async () => {
    deleteAnnotation.mockRejectedValue(conflictWith(annotation(2, 'server')));
    const state = useAnnotations(42);
    state.replaceAnnotations([annotation()]);
    expect(await state.deleteAnnotation('a1')).toBe(false);
    expect(state.annotations.value).toHaveLength(1);
    expect(deleteAnnotation).toHaveBeenCalledWith('a1', 1);
    expect(state.conflict.value).toMatchObject({ current: { revision: 2 }, attempted: { kind: 'delete' } });
    expect(state.syncStatus.value).toBe('conflict');
    const retry = state.prepareConflictRetry();
    expect(retry?.attempted).toEqual({ kind: 'delete' });
    deleteAnnotation.mockResolvedValue({ deleted: true });
    expect(await state.deleteAnnotation('a1')).toBe(true);
    expect(deleteAnnotation).toHaveBeenLastCalledWith('a1', 2);
  });

  it('冲突表·使用服务器版本：界面换成服务器版本，丢弃编辑稿，冲突解除，不再发请求', async () => {
    updateAnnotation.mockRejectedValue(conflictWith(annotation(2, 'server')));
    const state = useAnnotations(42);
    state.replaceAnnotations([annotation()]);
    await state.updateAnnotation('a1', { note: 'client' });
    state.useServerVersion();
    expect(state.annotations.value[0]).toMatchObject({ revision: 2, note: 'server' });
    expect(state.conflict.value).toBeNull();
    expect(state.syncStatus.value).toBe('synced');
    expect(updateAnnotation).toHaveBeenCalledTimes(1);
  });

  it('E5 修改一条已在其他设备删除的笔记 → 标记为"已在其他设备删除"，保留编辑稿以便复制或另存', async () => {
    updateAnnotation.mockRejectedValue({ code: 40401, details: { field: 'annotation', reason: 'RESOURCE_NOT_FOUND' } });
    const state = useAnnotations(42);
    state.replaceAnnotations([annotation()]);
    await state.updateAnnotation('a1', { note: '还没保存的想法' });
    expect(state.syncStatus.value).toBe('deleted-remotely');
    expect(state.conflict.value).toMatchObject({
      current: null,
      attempted: { kind: 'update', edits: { note: '还没保存的想法' } },
    });
  });
});
