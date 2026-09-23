import { createHash } from "node:crypto";
import type { BookDocument, DocumentTocNode, EpubBookLocatorV1 } from "../domain/book-document.types";
import { ReaderToolException } from "../domain/reader-tool-error";
import { contentRevisionKey, decodeCursor, encodeCursor, makeLocator } from "./reader-tool.utils";
import { resolveTocNodeRange } from "./toc-node-range.resolver";

export interface TocReadInput { nodeIds?: string[]; cursor?: string }
export const TOC_BATCH_CHARACTERS = 50_000;
export const TOC_BATCH_UNITS = 200;
export const TOC_CURSOR_MAX_LENGTH = 300_000;
export interface TocReadUnit {
  unitIndex: number;
  nodeId: string;
  label: string;
  kind: "subtree" | "own";
  normalizedCharCount: number;
  startLocator: EpubBookLocatorV1;
  endLocator: EpubBookLocatorV1;
}
interface Cursor { tool: string; bookId: number; revision: string; nodeIds: string[]; offset: number }

export function planTocRead(document: BookDocument, input: TocReadInput) {
  const invalid = (message: string): never => { throw new ReaderToolException("TOC_REQUEST_INVALID", message); };
  if (!input || Object.keys(input).some((key) => !["nodeIds", "cursor"].includes(key))) invalid("Use nodeIds or cursor only.");
  if ((input.nodeIds !== undefined) === (input.cursor !== undefined)) invalid("Exactly one of nodeIds and cursor is required.");
  const validIds = (value: unknown): value is string[] => Array.isArray(value) && value.length >= 1
    && value.length <= 200 && value.every((id) => typeof id === "string" && id.length >= 1 && id.length <= 256);
  let ids: string[];
  let offset = 0;
  if (input.cursor !== undefined) {
    if (typeof input.cursor !== "string" || input.cursor.length > TOC_CURSOR_MAX_LENGTH) invalid("Invalid cursor.");
    const cursor = decodeCursor<Cursor>(input.cursor, (value) => value.tool === "book_read_from_toc"
      && value.bookId === document.bookId && value.revision === contentRevisionKey(document.revision)
      && validIds(value.nodeIds) && Number.isSafeInteger(value.offset) && Number(value.offset) > 0);
    if (!cursor) throw new ReaderToolException("CURSOR_INVALID", "TOC reading cursor is invalid or stale", "cursor");
    ids = cursor.nodeIds;
    offset = cursor.offset;
  } else {
    if (!validIds(input.nodeIds)) invalid("nodeIds must contain between 1 and 200 current node IDs.");
    ids = input.nodeIds!;
  }
  const fail = (id: string, reason: string): never => { throw new ReaderToolException("EXTRACTION_FAILED", `Invalid TOC '${id}': ${reason}`); };
  const byId = new Map(document.toc.map((node) => [node.nodeId, node]));
  if (byId.size !== document.toc.length) fail("document", "duplicate node IDs");
  const children = new Map<string, DocumentTocNode[]>();
  for (const node of document.toc) if (node.parentNodeId !== null) {
    const siblings = children.get(node.parentNodeId) ?? [];
    siblings.push(node);
    children.set(node.parentNodeId, siblings);
  }
  const selected = new Set(ids);
  for (const id of ids) if (!byId.has(id)) throw new ReaderToolException("TOC_NODE_NOT_FOUND", `TOC node '${id}' is unavailable.`, "nodeIds");
  const roots = document.toc.filter((node) => {
    if (!selected.has(node.nodeId)) return false;
    const visited = new Set([node.nodeId]);
    let parentId = node.parentNodeId;
    let covered = false;
    while (parentId !== null) {
      if (visited.has(parentId)) fail(node.nodeId, "cyclic parents");
      visited.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) fail(node.nodeId, "missing parent");
      if (selected.has(parentId)) covered = true;
      parentId = parent!.parentNodeId;
    }
    return !covered;
  });
  const sections = [...document.sections].sort((a, b) => a.sectionIndex - b.sectionIndex);
  const bases = new Map<number, number>();
  let total = 0;
  for (const section of sections) { bases.set(section.sectionIndex, total); total += section.text.length; }
  const absolute = (locator: EpubBookLocatorV1): number => {
    const base = bases.get(locator.position.sectionIndex);
    const section = sections.find((item) => item.sectionIndex === locator.position.sectionIndex);
    if (base === undefined || !section || locator.position.start < 0 || locator.position.end > section.text.length) fail("document", "invalid endpoint");
    return base! + locator.position.start;
  };
  const locatorAt = (point: number, end: boolean): EpubBookLocatorV1 => {
    const section = (end ? [...sections].reverse() : sections).find((item) => {
      const base = bases.get(item.sectionIndex)!;
      return end ? point > base && point <= base + item.text.length : point >= base && point < base + item.text.length;
    });
    if (!section) fail("document", "unresolvable endpoint");
    const position = point - bases.get(section!.sectionIndex)!;
    return makeLocator(document, section!.sectionIndex, position, position);
  };
  const ranges = new Map<string, { start: number; end: number; startLocator: EpubBookLocatorV1; endLocator: EpubBookLocatorV1 }>();
  const visiting = new Set<string>();
  const validate = (node: DocumentTocNode) => {
    if (visiting.has(node.nodeId)) fail(node.nodeId, "cyclic children");
    visiting.add(node.nodeId);
    const range = resolveTocNodeRange(document, node.nodeId);
    const start = absolute(range.startLocator);
    const end = absolute(range.endLocator);
    if (end < start || end - start !== range.normalizedCharCount || node.subtreeCharCount !== end - start) fail(node.nodeId, "subtree count mismatch");
    const direct = children.get(node.nodeId) ?? [];
    if (node.hasChildren !== (direct.length > 0)) fail(node.nodeId, "hasChildren mismatch");
    let previous = start;
    let childChars = 0;
    for (const child of direct) {
      if (child.level <= node.level || child.linearIndex <= node.linearIndex) fail(child.nodeId, "invalid hierarchy order");
      validate(child);
      const childRange = ranges.get(child.nodeId)!;
      if (childRange.start < previous || childRange.end > end) fail(child.nodeId, "overlapping or out-of-parent range");
      childChars += childRange.end - childRange.start;
      previous = childRange.end;
    }
    if (node.ownCharCount !== end - start - childChars) fail(node.nodeId, "own count mismatch");
    ranges.set(node.nodeId, { start, end, startLocator: range.startLocator, endLocator: range.endLocator });
    visiting.delete(node.nodeId);
  };
  let previousEnd = -1;
  for (const root of roots) {
    validate(root);
    const range = ranges.get(root.nodeId)!;
    if (range.start < previousEnd) fail(root.nodeId, "overlapping roots");
    previousEnd = range.end;
  }
  const units: TocReadUnit[] = [];
  const add = (node: DocumentTocNode, kind: TocReadUnit["kind"], start: number, end: number) => {
    const range = ranges.get(node.nodeId)!;
    units.push({ unitIndex: units.length, nodeId: node.nodeId, label: node.label, kind, normalizedCharCount: end - start,
      startLocator: end > start ? locatorAt(start, false) : range.startLocator,
      endLocator: end > start ? locatorAt(end, true) : range.endLocator });
  };
  const split = (node: DocumentTocNode) => {
    const range = ranges.get(node.nodeId)!;
    const direct = children.get(node.nodeId) ?? [];
    if (node.subtreeCharCount <= TOC_BATCH_CHARACTERS || direct.length === 0) { add(node, "subtree", range.start, range.end); return; }
    let start = range.start;
    for (const child of direct) {
      const childRange = ranges.get(child.nodeId)!;
      if (childRange.start > start) add(node, "own", start, childRange.start);
      split(child);
      start = childRange.end;
    }
    if (start < range.end) add(node, "own", start, range.end);
  };
  roots.forEach(split);
  const readable = (unit: TocReadUnit) => unit.normalizedCharCount > 0 && unit.normalizedCharCount <= TOC_BATCH_CHARACTERS;
  const batchEnd = (from: number) => {
    let index = from;
    let chars = 0;
    while (index < units.length && index - from < TOC_BATCH_UNITS) {
      const unit = units[index];
      if (readable(unit)) {
        if (chars + unit.normalizedCharCount > TOC_BATCH_CHARACTERS) break;
        chars += unit.normalizedCharCount;
      }
      index++;
    }
    return index;
  };
  if (input.cursor !== undefined) {
    let boundary = 0;
    while (boundary < offset && boundary < units.length) boundary = batchEnd(boundary);
    if (boundary !== offset || offset >= units.length || JSON.stringify(ids) !== JSON.stringify(roots.map((node) => node.nodeId))) {
      throw new ReaderToolException("CURSOR_INVALID", "Cursor does not identify a canonical batch boundary", "cursor");
    }
  }
  const end = batchEnd(offset);
  const batch = units.slice(offset, end);
  const selectedNodeIds = roots.map((node) => node.nodeId);
  const selectionId = createHash("sha256").update(JSON.stringify([document.bookId, document.revision, selectedNodeIds])).digest("hex");
  const sum = (items: TocReadUnit[]) => items.reduce((count, unit) => count + unit.normalizedCharCount, 0);
  const blocked = units.filter((unit) => !readable(unit));
  return {
    units: batch.filter(readable),
    unavailable: batch.filter((unit) => !readable(unit)).map((unit) => ({ ...unit,
      reason: unit.normalizedCharCount === 0 ? "TOC_NODE_NOT_READABLE" as const : "TOC_NODE_TOO_LARGE" as const,
      message: unit.normalizedCharCount === 0 ? "Node contains no readable text." : "Cannot read this unit completely using the existing TOC structure.",
      maxCompleteChars: TOC_BATCH_CHARACTERS })),
    normalizedCharCount: sum(batch.filter(readable)),
    continuation: { next: end < units.length ? { cursor: encodeCursor({ tool: "book_read_from_toc", bookId: document.bookId,
      revision: contentRevisionKey(document.revision), nodeIds: selectedNodeIds, offset: end }) } : null },
    coverage: { selectionId, selectedNodeIds, totalChars: sum(units),
      returnedChars: sum(units.slice(0, end).filter(readable)), pendingChars: sum(units.slice(end).filter(readable)),
      unavailableChars: sum(blocked), unavailableUnits: blocked.length, processedUnits: end, totalUnits: units.length,
      complete: end === units.length && blocked.length === 0 },
  };
}
