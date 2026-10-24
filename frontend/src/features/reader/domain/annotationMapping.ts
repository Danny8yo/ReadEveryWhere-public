// 标注按章节过滤：解决"每章加载都重绘全部标注"导致的重复/竞态。
// 只挑出应画在指定章节的标注：
//   - sectionIndex === 目标章节 → 属于本章
//   - sectionIndex == null（旧数据无章节信息）→ 兜底：任意章节都返回，保持旧行为不丢显示
// 保持输入顺序。

interface HasSectionIndex {
  sectionIndex?: number | null;
}

export function annotationsForSection<T extends HasSectionIndex>(
  list: readonly T[],
  sectionIndex: number,
): T[] {
  return list.filter((a) => a.sectionIndex == null || a.sectionIndex === sectionIndex);
}
