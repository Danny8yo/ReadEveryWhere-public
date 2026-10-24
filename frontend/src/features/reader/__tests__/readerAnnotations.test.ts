import { describe, expect, it } from 'vitest';
// 阅读器纯规则：domain/annotationMapping.ts
import { annotationsForSection } from '../domain/annotationMapping';

/**
 * 标注重绘去重：现状是每个章节加载都重绘"全部"标注（重复/竞态）。
 * annotationsForSection 只挑出应画在该章节的标注：
 *   - sectionIndex === 该章 → 属于本章
 *   - sectionIndex == null（旧数据无章节信息）→ 兜底：每章都画（保持旧行为，避免丢显示）
 */
const A = (id: string, sectionIndex: number | null) => ({ id, sectionIndex } as any);

describe('annotationsForSection', () => {
  it('只返回属于该章节的标注', () => {
    const list = [A('a', 2), A('b', 3), A('c', 2)];
    expect(annotationsForSection(list, 2).map((x) => x.id)).toEqual(['a', 'c']);
    expect(annotationsForSection(list, 3).map((x) => x.id)).toEqual(['b']);
  });

  it('sectionIndex 为 null 的标注对任意章节都返回（兜底旧数据）', () => {
    const list = [A('legacy', null), A('a', 2)];
    expect(annotationsForSection(list, 2).map((x) => x.id)).toEqual(['legacy', 'a']);
    expect(annotationsForSection(list, 5).map((x) => x.id)).toEqual(['legacy']);
  });

  it('空列表返回空', () => {
    expect(annotationsForSection([], 0)).toEqual([]);
  });
});
