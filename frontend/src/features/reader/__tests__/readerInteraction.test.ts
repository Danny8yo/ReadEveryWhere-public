import { describe, expect, it } from 'vitest';
import { canTurnByEdge, readerRelocatePosition, resolveReaderTapAction, type ReaderInteractionState } from '../domain/interaction';

const reading: ReaderInteractionState = {
  blocked: false, panelOpen: false, noteModalVisible: false,
  toolbarVisible: false, footnoteVisible: false, paginated: true,
};

describe('内容区交互策略', () => {
  it('分页时边缘翻页，取消选区不显隐，其余区域显隐', () => {
    expect(resolveReaderTapAction('next', reading)).toBe('next');
    expect(resolveReaderTapAction('prev', reading)).toBe('prev');
    expect(resolveReaderTapAction('body', reading)).toBe('none');
    expect(resolveReaderTapAction('center', reading)).toBe('toggle-ui');
  });
  it.each(['blocked', 'panelOpen', 'noteModalVisible'] as const)('%s 时阻止翻页及显隐', key => {
    const state = { ...reading, [key]: true };
    expect(canTurnByEdge(state)).toBe(false);
    expect(resolveReaderTapAction('next', state)).toBe('none');
    expect(resolveReaderTapAction('center', state)).toBe('none');
  });
  it.each(['toolbarVisible', 'footnoteVisible'] as const)('%s 时一次点击仅关闭浮层', key => {
    const state = { ...reading, [key]: true };
    expect(canTurnByEdge(state)).toBe(false);
    for (const side of ['next', 'center', 'body'] as const) {
      expect(resolveReaderTapAction(side, state)).toBe('dismiss-popups');
    }
  });
  it('滚动模式所有有效区域显隐，取消选区不显隐', () => {
    const state = { ...reading, paginated: false };
    expect(canTurnByEdge(state)).toBe(false);
    for (const side of ['prev', 'next', 'center'] as const)
      expect(resolveReaderTapAction(side, state)).toBe('toggle-ui');
    expect(resolveReaderTapAction('body', state)).toBe('none');
  });
});

describe('relocate 阅读位置', () => {
  const epub = (sectionIndex: number, fraction: number) =>
    readerRelocatePosition({ locator: {}, sectionIndex, fraction });
  const pdf = (page: number, fraction: number) =>
    readerRelocatePosition({ locator: { readerAnchors: { pdf: { page } } }, fraction } as never);

  it('位置不变的 relocate 视为同一位置，不应关闭选区工具栏', () => {
    expect(epub(1, 0.0227)).toBe(epub(1, 0.0227));
    expect(pdf(3, 0.5)).toBe(pdf(3, 0.5));
  });
  it('翻页、换章与 PDF 换页都视为位置变化', () => {
    expect(epub(1, 0.0227)).not.toBe(epub(1, 0.05));
    expect(epub(1, 0.5)).not.toBe(epub(2, 0.5));
    expect(pdf(3, 0.5)).not.toBe(pdf(4, 0.5));
  });
});
