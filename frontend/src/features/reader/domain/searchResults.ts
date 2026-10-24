// 全文搜索结果分组：引擎产出扁平结果，UI 按章节分组展示。
// 按 chapterLabel 分组，保留章节"首次出现"顺序与组内顺序；
// chapterLabel 为空串归入统一的"未分章"组；空输入返回 []。

export interface SearchResultItem {
  cfi: string;
  excerpt: string;
  chapterLabel: string;
}

const UNGROUPED_LABEL = '未分章';

export function groupResultsByChapter(
  results: readonly SearchResultItem[],
): { chapter: string; items: SearchResultItem[] }[] {
  const groups: { chapter: string; items: SearchResultItem[] }[] = [];
  const index = new Map<string, { chapter: string; items: SearchResultItem[] }>();

  for (const item of results) {
    const chapter = item.chapterLabel === '' ? UNGROUPED_LABEL : item.chapterLabel;
    let group = index.get(chapter);
    if (!group) {
      group = { chapter, items: [] };
      index.set(chapter, group);
      groups.push(group);
    }
    group.items.push(item);
  }

  return groups;
}
