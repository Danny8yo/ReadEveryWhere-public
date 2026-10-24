import { describe, expect, it } from 'vitest';
// 阅读器纯规则：domain/searchResults.ts
import { groupResultsByChapter, type SearchResultItem } from '../domain/searchResults';

/**
 * 全文搜索：引擎(view.search)产出扁平结果，UI 需按章节分组展示。
 * groupResultsByChapter 按 chapterLabel 分组，保持"首次出现"的章节顺序与组内顺序。
 */
const r = (cfi: string, chapterLabel: string, excerpt = ''): SearchResultItem => ({
  cfi,
  excerpt,
  chapterLabel,
});

describe('groupResultsByChapter', () => {
  it('按章节分组，保留章节首现顺序与组内顺序', () => {
    const results = [
      r('c1', '第一章'),
      r('c2', '第一章'),
      r('c3', '第二章'),
      r('c4', '第一章'), // 第一章再次出现，应归入已存在的第一章组
    ];
    const groups = groupResultsByChapter(results);
    expect(groups.map((g) => g.chapter)).toEqual(['第一章', '第二章']);
    expect(groups[0].items.map((i) => i.cfi)).toEqual(['c1', 'c2', 'c4']);
    expect(groups[1].items.map((i) => i.cfi)).toEqual(['c3']);
  });

  it('无章节标签的结果归入统一的"未分章"组', () => {
    const groups = groupResultsByChapter([r('c1', ''), r('c2', '')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].chapter).toBe('未分章');
    expect(groups[0].items).toHaveLength(2);
  });

  it('空结果返回空数组', () => {
    expect(groupResultsByChapter([])).toEqual([]);
  });
});
