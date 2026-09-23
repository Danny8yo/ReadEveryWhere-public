import { describe, expect, it } from 'vitest';
import { canTurnByEdge, resolveReaderTapAction, type ReaderInteractionState } from '../lib/reader/interaction';

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
