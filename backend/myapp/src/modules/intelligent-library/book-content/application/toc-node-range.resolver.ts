import type { BookDocument, DocumentTocNode, EpubBookLocatorV1 } from "../domain/book-document.types";
import { ReaderToolException } from "../domain/reader-tool-error";
import { makeLocator } from "./reader-tool.utils";

export interface TocNodeRange {
  node: DocumentTocNode;
  startLocator: EpubBookLocatorV1;
  endLocator: EpubBookLocatorV1;
  readable: boolean;
  normalizedCharCount: number;
}

export function resolveTocNodeRange(
  document: BookDocument,
  nodeId: string,
  field = "nodeId",
): TocNodeRange {
  const node = document.toc.find((candidate) => candidate.nodeId === nodeId);
  if (!node) {
    throw new ReaderToolException(
      "TOC_NODE_NOT_FOUND",
      `TOC node '${nodeId}' is no longer available. Refresh the outline and select a current nodeId.`,
      field,
    );
  }

  const rawStart = { sectionIndex: node.sectionIndex, offset: node.start };
  const rawEnd = nodeEnd(document, node);
  const slices = document.sections
    .filter((section) => section.sectionIndex >= rawStart.sectionIndex && section.sectionIndex <= rawEnd.sectionIndex)
    .sort((left, right) => left.sectionIndex - right.sectionIndex)
    .map((section) => ({
      section,
      start: section.sectionIndex === rawStart.sectionIndex ? rawStart.offset : 0,
      end: section.sectionIndex === rawEnd.sectionIndex ? rawEnd.offset : section.text.length,
    }))
    .filter(({ start, end }) => end > start);

  const first = slices[0];
  const last = slices[slices.length - 1];
  return {
    node,
    startLocator: first
      ? makeLocator(document, first.section.sectionIndex, first.start, first.start)
      : makeLocator(document, rawStart.sectionIndex, rawStart.offset, rawStart.offset),
    endLocator: last
      ? makeLocator(document, last.section.sectionIndex, last.end, last.end)
      : makeLocator(document, rawEnd.sectionIndex, rawEnd.offset, rawEnd.offset),
    readable: Boolean(first && last),
    normalizedCharCount: slices.reduce((total, item) => total + item.end - item.start, 0),
  };
}

function nodeEnd(document: BookDocument, node: DocumentTocNode): { sectionIndex: number; offset: number } {
  if (node.endSectionIndex !== undefined && node.end !== undefined) {
    return { sectionIndex: node.endSectionIndex, offset: node.end };
  }
  const boundary = document.toc
    .slice(node.linearIndex + 1)
    .find((candidate) => candidate.level <= node.level);
  if (boundary) return { sectionIndex: boundary.sectionIndex, offset: boundary.start };
  const lastSection = document.sections[document.sections.length - 1];
  return { sectionIndex: lastSection.sectionIndex, offset: lastSection.text.length };
}
