import { canonicalToSource, rangeFromSource, nodeAt } from "./index.js";
import * as CFI from "./foliate/epubcfi.js";
export const CHUNKER_VERSION = `epub-chunks-v2-structure-800-1200-soft1600-scope2-icu${process.versions.icu}-unicode${process.versions.unicode}`;
// Search the packed intervals directly. No per-character boundary arrays.
export function nextSourceStart(map, target) {
  const segments = map.segments;
  let lo = 0,
    hi = segments.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (segments.data[mid * 8 + 1] <= target) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < segments.length; i++) {
    const row = i * 8,
      d = segments.data;
    if (!d[row + 2]) continue;
    if (d[row + 7] & 2) return Math.max(target, d[row]);
    if (d[row] >= target) return d[row];
  }
}
export function previousSourceEnd(map, target) {
  const segments = map.segments;
  let lo = 0,
    hi = segments.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (segments.data[mid * 8] < target) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo - 1; i >= 0; i--) {
    const row = i * 8,
      d = segments.data;
    if (!d[row + 4]) continue;
    if (d[row + 7] & 2) return Math.min(target, d[row + 1]);
    if (d[row + 1] <= target) return d[row + 1];
  }
}
// Structure is derived from the unchanged canonical map and original DOM.
// Keep only one record per DOM block/sentence, never per UTF-16 character.
const blockTags = new Set("p div section article aside header footer h1 h2 h3 h4 h5 h6 blockquote li pre table figure figcaption dt dd address caption main nav".split(" "));
const sectionTags = new Set(["section", "article", "aside", "nav"]);
export function structureUnits(document, map) {
  const owners = map.segments.paths.map(path => {
    let element = nodeAt(document, path).parentElement, owner = null, row = null, scope = null;
    while (element && element !== document.body) {
      const tag = element.localName.toLowerCase();
      if (!owner && blockTags.has(tag)) owner = element;
      if (!scope && sectionTags.has(tag)) scope = element;
      if (tag === "tr") row = element;
      if (tag === "pre" || tag === "table") owner = element;
      element = element.parentElement;
    }
    return { owner: owner || document.body, row, scope: scope || document.body };
  });
  const units = [];
  for (let i = 0; i < map.segments.length; i++) {
    const d = map.segments.data, row = i * 8;
    if (!d[row + 2] || !d[row + 4]) continue;
    const { owner, row: tableRow, scope } = owners[d[row + 2] - 1];
    const last = units.at(-1);
    if (last && last.owner === owner && last.scope === scope) last.end = d[row + 1];
    else units.push({ start: d[row], end: d[row + 1], owner, scope, rows: [] });
    if (tableRow) {
      const rows = units.at(-1).rows, prior = rows.at(-1);
      if (prior && prior.owner === tableRow) prior.end = d[row + 1];
      else rows.push({ start: d[row], end: d[row + 1], owner: tableRow });
    }
  }
  let group = 0, previousScope = null;
  return units.map(unit => {
    const tag = unit.owner.localName.toLowerCase();
    // Entering or leaving a semantic section is a boundary even without a heading.
    if (unit.scope !== previousScope || /^h[1-6]$/.test(tag)) group++;
    previousScope = unit.scope;
    return { start: unit.start, end: unit.end, tag, group,
      rows: unit.rows.map(({start, end}) => ({start, end, tag: "table-row", group})) };
  });
}
function splitUnit(map, unit, cap = 1600, sentences = false) {
  if (!sentences && unit.end - unit.start <= cap) return [{ ...unit, forced: false }];
  if (unit.tag === "table" && unit.rows.length > 1)
    return unit.rows.flatMap(row => splitUnit(map, row, cap, sentences));
  const atoms = [];
  // Code/table line boundaries take priority over linguistic punctuation.
  const text = map.text.slice(unit.start, unit.end);
  const pieces = (unit.tag === "pre" || unit.tag === "table" || unit.tag === "table-row")
    ? text.matchAll(/[^\n]+(?:\n|$)/g)
    : new Intl.Segmenter("und", { granularity: "sentence" }).segment(text);
  for (const piece of pieces) {
    const value = piece.segment === undefined ? piece[0] : piece.segment;
    let start = nextSourceStart(map, unit.start + piece.index);
    const sentenceForced = value.length > cap;
    const end = previousSourceEnd(map, unit.start + piece.index + value.length);
    if (start === undefined || end === undefined || start >= end) continue;
    while (start < end) {
      const forced = end - start > cap;
      const to = forced ? previousSourceEnd(map, start + 1200) : end;
      if (to === undefined || to <= start)
        throw new Error("CHUNK_UNREPRESENTABLE: normalization atom exceeds chunk budget");
      atoms.push({ ...unit, start, end: to, forced: sentenceForced });
      const next = nextSourceStart(map, to);
      if (next === undefined || next >= end) break;
      start = next;
    }
  }
  return atoms;
}
export function surroundingRange(map, start, end, cap, document, preparedUnits) {
  if (!Number.isInteger(cap) || cap < 1 || cap > 12000 ||
      !Number.isInteger(start) || !Number.isInteger(end) || start < 0 ||
      end <= start || end - start > cap || end > map.text.length)
    throw new Error("Invalid context range");
  if (!document) throw new Error("Structure context requires its source document");
  const units = preparedUnits || structureUnits(document, map);
  const first = units.findIndex(u => u.end > start);
  let last = units.findIndex(u => u.end >= end);
  if (first < 0 || last < first) throw new Error("CONTEXT_UNREPRESENTABLE");
  const lower = units[first].group, upper = units[last].group;
  let from = start, to = end, left = first, right = last;
  // Complete the containing blocks, then alternate preceding/following blocks.
  if (units[last].end - units[first].start <= cap) {
    from = units[first].start; to = units[last].end;
  }
  let changed = true;
  while (changed) {
    changed = false;
    if (left > 0 && units[left - 1].group === lower && to - units[left - 1].start <= cap) {
      from = units[--left].start; changed = true;
    }
    if (right + 1 < units.length && units[right + 1].group === upper && units[right + 1].end - from <= cap) {
      to = units[++right].end; changed = true;
    }
  }
  // A long containing/adjacent paragraph can contribute complete nearby sentences.
  const groupStart = units.find(u => u.group === lower).start;
  const groupEnd = units.findLast(u => u.group === upper).end;
  const desiredStart = Math.max(groupStart, from - Math.floor((cap - (to - from)) / 2));
  const desiredEnd = Math.min(groupEnd, desiredStart + cap);
  const nearby = units.filter(u => u.end > desiredStart && u.start < desiredEnd)
    .flatMap(u => splitUnit(map, u, 1600, true));
  const containingStart = nearby.find(a => a.start <= from && a.end > from);
  const containingEnd = nearby.find(a => a.start < to && a.end >= to);
  if (containingStart && containingEnd && !containingStart.forced && !containingEnd.forced &&
      containingEnd.end - containingStart.start <= cap) {
    from = containingStart.start; to = containingEnd.end;
  }
  for (let i = nearby.length - 1; i >= 0; i--) {
    const a = nearby[i];
    if (!a.forced && a.end <= from && a.start >= groupStart && to - a.start <= cap) from = a.start;
  }
  for (const a of nearby) {
    if (!a.forced && a.start >= to && a.end <= groupEnd && a.end - from <= cap) to = a.end;
  }
  // Selection itself is always retained. Flag genuinely partial sentence/structure endpoints.
  const boundaries = units.flatMap(u => splitUnit(map, u, 1600, true));
  const completeStart = () => boundaries.some(u => u.start === from && !u.forced);
  const completeEnd = () => boundaries.some(u => u.end === to && !u.forced);
  // A sentence/code line may exceed the entire context budget. Still provide
  // useful surrounding source text instead of silently returning only the selection.
  const extendLeft = !completeStart(), extendRight = !completeEnd();
  if (extendLeft || extendRight) {
    const available = cap - (to - from);
    if (extendLeft) {
      const target = Math.max(groupStart, from - (extendRight ? Math.floor(available / 2) : available));
      const safe = nextSourceStart(map, target);
      if (safe !== undefined && safe <= from) from = safe;
    }
    if (extendRight) {
      const safe = previousSourceEnd(map, Math.min(groupEnd, to + cap - (to - from)));
      if (safe !== undefined && safe >= to) to = safe;
    }
    // Near the section end, reuse the remaining allowance on the leading side.
    if (extendLeft) {
      const safe = nextSourceStart(map, Math.max(groupStart, from - (cap - (to - from))));
      if (safe !== undefined && safe <= from) from = safe;
    }
  }
  return { start: from, end: to, contextTruncated:
    !completeStart() || !completeEnd() };
}
export function* chunkSection(document, map, baseCFI) {
  const units = structureUnits(document, map).flatMap(u => splitUnit(map, u));
  let i = 0;
  while (i < units.length) {
    const first = units[i];
    let j = i + 1, end = first.end;
    while (j < units.length && units[j].group === first.group &&
           units[j].end - first.start <= (end - first.start < 800 ? 1600 : 1200)) {
      end = units[j++].end;
    }
    const start = first.start;
    const source = canonicalToSource(map, { start, end });
    const range = rangeFromSource(document, source);
    yield { start, end, quote: map.text.slice(start, end), displayedQuote: range.toString(),
      source, cfi: CFI.joinIndir(baseCFI, CFI.fromRange(range)),
      boundaryTruncated: first.forced || units[j - 1].forced };
    if (j === units.length) break;
    // Overlap only a complete short unit, never an arbitrary suffix.
    i = j - i > 1 && units[j - 1].end - units[j - 1].start <= 200 && !units[j - 1].forced
      ? j - 1 : j;
  }
}
