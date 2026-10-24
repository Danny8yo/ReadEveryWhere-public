// @vitest-environment happy-dom
import { enableAutoUnmount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReadingProfileDrawer from '../ui/ReadingProfileDrawer.vue';
import { mountInBody } from '../../../__tests__/helpers/bodyView';

const api = vi.hoisted(() => ({ applyCandidate: vi.fn(), updateProfile: vi.fn(), clearProfile: vi.fn() }));
vi.mock('../api/bookAnalysisApi', () => ({ bookAnalysisApi: { applyCandidate: api.applyCandidate } }));
vi.mock('../../library/api/libraryApi', () => ({
  updateBookReadingProfile: api.updateProfile,
  clearBookReadingProfile: api.clearProfile,
}));
vi.mock('../../library/web/librarySession', () => ({
  useLibraryInvalidation: () => ({ invalidate: vi.fn() }),
  withLibraryInvalidation: (_port: unknown, command: unknown) => command,
}));

enableAutoUnmount(afterEach);
beforeEach(() => vi.clearAllMocks());

const book = {
  id: 'library:42',
  title: '结构化阅读',
  authors: ['测试作者'],
  readingProfile: null,
  bookAnalysis: {
    status: 'ready', primaryGenre: 'argumentation', displayLabel: '论证类', confidence: 0.9,
    analyzedAt: '2026-08-31T00:00:00.000Z', stale: false, candidateId: 'candidate-1',
  },
};

function openDrawer() {
  return mountInBody(ReadingProfileDrawer, { props: { open: true, book: book as never, libraryBookId: 42 } });
}
const button = (wrapper: ReturnType<typeof openDrawer>, label: string) => {
  const found = wrapper.findAll('button').find((candidate) => candidate.text().includes(label));
  if (!found) throw new Error(`找不到按钮：${label}`);
  return found;
};

// 编号对应 doc/同步测试用例审查.md
describe('画像抽屉：你自己的操作失败时能看到错误提示', () => {
  it('N12 应用 AI 分析结果失败 → 抽屉里显示错误提示，不当作成功', async () => {
    api.applyCandidate.mockRejectedValue(new Error('书籍已被修改，请刷新后重试'));
    const wrapper = openDrawer();
    await button(wrapper, '应用 AI 候选').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('书籍已被修改，请刷新后重试');
    expect(wrapper.emitted('profileUpdated')).toBeUndefined();
  });

  it('N12 保存画像失败 → 抽屉里显示错误提示，不当作成功', async () => {
    api.updateProfile.mockRejectedValue(new Error('保存失败：网络中断'));
    const wrapper = openDrawer();
    await button(wrapper, '保存画像').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('保存失败：网络中断');
    expect(wrapper.emitted('profileUpdated')).toBeUndefined();
  });
});
