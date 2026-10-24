export function relocateSectionIndex(detail: unknown, fixedLayout: boolean): number | undefined {
  if (!detail || typeof detail !== 'object') return undefined;
  const value = detail as { index?: unknown; section?: { current?: unknown } };
  const sectionCurrent = value.section?.current;
  if (fixedLayout && typeof sectionCurrent === 'number') return sectionCurrent;
  return typeof value.index === 'number' ? value.index : undefined;
}
