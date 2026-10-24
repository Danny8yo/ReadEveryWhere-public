import { describe, expect, it } from 'vitest';
import { relocateSectionIndex } from '../domain/relocate';

describe('阅读器当前章节焦点', () => {
  it('EPUB 使用 relocate 原始 index', () => {
    expect(relocateSectionIndex({ index: 7, section: { current: 2 } }, false)).toBe(7);
  });

  it('固定布局使用真实 section.current，并拒绝非法索引', () => {
    expect(relocateSectionIndex({ index: 2, section: { current: 9 } }, true)).toBe(9);
    expect(relocateSectionIndex({ index: '7' }, false)).toBeUndefined();
  });
});
