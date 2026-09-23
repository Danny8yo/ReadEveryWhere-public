import { describe, expect, it } from 'vitest';
// TDD：待实现 lib/reader/bookmarks.ts
import { isBookmarked, toggleBookmark, type Bookmark } from '../lib/reader/bookmarks';

/**
 * 书签纯逻辑：以 CFI 为身份。isBookmarked 判定当前位置是否已加书签；
 * toggleBookmark 纯函数返回新数组 + 本次是新增还是移除。
 */
const bm = (cfi: string, chapterLabel = ''): Bookmark => ({ cfi, fraction: 0, chapterLabel });

describe('isBookmarked', () => {
  it('命中相同 CFI 返回 true，否则 false', () => {
    const list = [bm('epubcfi(/6/4!/2)'), bm('epubcfi(/6/8!/4)')];
    expect(isBookmarked(list, 'epubcfi(/6/4!/2)')).toBe(true);
    expect(isBookmarked(list, 'epubcfi(/6/6!/1)')).toBe(false);
  });
  it('空列表返回 false', () => {
    expect(isBookmarked([], 'epubcfi(/6/4!/2)')).toBe(false);
  });
});

describe('toggleBookmark', () => {
  it('不存在则新增（added=true，长度 +1）', () => {
    const list = [bm('cfi-A')];
    const { next, added } = toggleBookmark(list, bm('cfi-B', '第二章'));
    expect(added).toBe(true);
    expect(next).toHaveLength(2);
    expect(next.some((b) => b.cfi === 'cfi-B')).toBe(true);
    // 不改动原数组（纯函数）
    expect(list).toHaveLength(1);
  });

  it('已存在则移除（added=false，长度 -1）', () => {
    const list = [bm('cfi-A'), bm('cfi-B')];
    const { next, added } = toggleBookmark(list, bm('cfi-A'));
    expect(added).toBe(false);
    expect(next).toHaveLength(1);
    expect(next.some((b) => b.cfi === 'cfi-A')).toBe(false);
  });
});
