import type { BookDocument } from "../domain/book-document.types";

export interface TocTreeEntry {
  nodeId: string;
  linearIndex: number;
  label: string;
  ownCharCount: number;
  subtreeCharCount: number;
  children: TocTreeEntry[];
}

export function buildTocTreeEntries(document: BookDocument): TocTreeEntry[] {
  const entriesByNodeId = new Map<string, TocTreeEntry>();
  for (const node of document.toc) {
    entriesByNodeId.set(node.nodeId, {
      nodeId: node.nodeId,
      linearIndex: node.linearIndex,
      label: node.label,
      ownCharCount: node.ownCharCount,
      subtreeCharCount: node.subtreeCharCount,
      children: [],
    });
  }

  const entries: TocTreeEntry[] = [];
  for (const node of document.toc) {
    const entry = entriesByNodeId.get(node.nodeId)!;
    const parent = node.parentNodeId ? entriesByNodeId.get(node.parentNodeId) : undefined;
    if (parent) parent.children.push(entry);
    else entries.push(entry);
  }
  return entries;
}
