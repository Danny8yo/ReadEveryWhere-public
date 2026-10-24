export interface QaRange { sectionIndex: number; start: number; end: number }
function union(ranges: QaRange[]): QaRange[] {
  const result: QaRange[] = [];
  for (const range of [...ranges].sort((a, b) => a.sectionIndex - b.sectionIndex || a.start - b.start)) {
    if (!Number.isSafeInteger(range.sectionIndex) || range.sectionIndex < 0 || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 || range.end <= range.start)
      throw new Error("Invalid canonical coverage interval");
    const last = result[result.length - 1];
    if (last && last.sectionIndex === range.sectionIndex && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else result.push({ ...range });
  }
  return result;
}
function subtract(targets: QaRange[], acquired: QaRange[]): QaRange[] {
  return union(targets).flatMap(target => {
    let start = target.start;
    const missing: QaRange[] = [];
    for (const read of acquired.filter(r => r.sectionIndex === target.sectionIndex && r.end > start && r.start < target.end)) {
      if (read.start > start) missing.push({ ...target, start, end: Math.min(read.start, target.end) });
      start = Math.max(start, read.end);
    }
    if (start < target.end) missing.push({ ...target, start });
    return missing;
  });
}
/** One host-owned book/revision per ledger. Only successfully verified evidence enters coverage. */
export class QaCoverage {
  private acquired: QaRange[] = [];
  private readonly targets = new Map<string, QaRange[]>();
  private readonly limitations = new Map<string, Record<string, unknown>>();
  record(range: QaRange) { this.acquired = union([...this.acquired, range]); }
  target(id: string, ranges: QaRange[]) {
    const normalized = union(ranges);
    const previous = this.targets.get(id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(normalized)) throw new Error("Coverage target changed within one revision");
    this.targets.set(id, normalized);
  }
  limitation(value: Record<string, unknown>) { this.limitations.set(JSON.stringify(value), value); }
  snapshot() {
    return { uniqueReadChars: this.acquired.reduce((n, r) => n + r.end - r.start, 0), verifiedRanges: this.acquired,
      targets: [...this.targets].map(([nodeId, ranges]) => { const unread = subtract(ranges, this.acquired);
        return { nodeId, ranges, unread, complete: ranges.length > 0 && unread.length === 0 }; }),
      observedLimitations: [...this.limitations.values()],
      notice: "Verified run coverage is not evidence visible in this model input, nor semantic sufficiency. Observed batch limitations remain recorded even when later explicit reads cover the target.",
    };
  }
}
