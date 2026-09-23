// 书签纯逻辑：以 CFI 为身份。
// isBookmarked 判定某位置是否已加书签；toggleBookmark 为纯函数，
// 已存在则移除、不存在则新增，返回新数组，且不改动原数组。

export interface Bookmark {
  id?: string;
  cfi: string;
  fraction: number;
  chapterLabel?: string;
}

// 列表中存在相同 CFI 即视为已加书签。
export function isBookmarked(list: readonly Bookmark[], cfi: string): boolean {
  return list.some((b) => b.cfi === cfi);
}

// 纯函数：entry.cfi 已在则移除（added=false），否则新增（added=true）。
export function toggleBookmark(
  list: readonly Bookmark[],
  entry: Bookmark,
): { next: Bookmark[]; added: boolean } {
  if (isBookmarked(list, entry.cfi)) {
    return { next: list.filter((b) => b.cfi !== entry.cfi), added: false };
  }
  return { next: [...list, entry], added: true };
}
