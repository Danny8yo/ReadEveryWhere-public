import type {
  BookDocument,
  Citation,
  ContentRevision,
  EpubBookLocatorV1,
  EvidenceType,
} from "../domain/book-document.types";
import { ReaderToolException } from "../domain/reader-tool-error";

export function encodeCursor(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor<T>(
  cursor: string | undefined,
  validate: (value: Record<string, unknown>) => boolean,
): T | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" && validate(parsed) ? parsed as T : null;
  } catch {
    return null;
  }
}

export function contentRevisionKey(revision: ContentRevision): string {
  return [
    revision.fileChecksum,
    revision.extractorVersion,
    revision.normalizationVersion,
  ].join("\u0000");
}

export function makeLocator(
  document: BookDocument,
  sectionIndex: number,
  start: number,
  end: number,
  exactQuote?: string,
): EpubBookLocatorV1 {
  const section = document.sections.find((candidate) => candidate.sectionIndex === sectionIndex);
  if (!section || start < 0 || end < start || end > section.text.length) {
    throw new ReaderToolException("LOCATOR_OUT_OF_RANGE", "Locator is outside normalized section text", "locator");
  }

  const structure = structureAt(document, sectionIndex, start);
  const quoteSource = exactQuote ?? (end > start ? section.text.slice(start, end) : "");
  const exact = sentenceAwareTextQuote(quoteSource);
  const exactEnd = start + exact.length;
  return {
    version: 1,
    bookId: document.bookId,
    contentRevision: document.revision,
    position: { kind: "epub_text", sectionIndex, start, end },
    ...(exact
      ? {
          textQuote: {
            exact,
            prefix: section.text.slice(Math.max(0, start - 64), start),
            suffix: section.text.slice(exactEnd, Math.min(section.text.length, exactEnd + 64)),
          },
        }
      : {}),
    structure: {
      ...(structure
        ? {
            tocNodeId: structure.nodeId,
            label: structure.label,
            path: structure.path,
            fragment: structure.fragment ?? undefined,
          }
        : {}),
      href: section.href,
    },
  };
}

function sentenceAwareTextQuote(value: string): string {
  if (value.length <= 256) return value;
  const window = value.slice(0, 256);
  const minimumSentenceLength = 128;
  for (let index = window.length - 1; index >= minimumSentenceLength; index -= 1) {
    if (!/[。！？.!?]/u.test(window[index])) continue;
    let end = index + 1;
    while (end < window.length && /[”’」』】）》]/u.test(window[end])) end += 1;
    return window.slice(0, end);
  }
  for (let index = window.length - 1; index >= 192; index -= 1) {
    if (/\s/u.test(window[index])) return window.slice(0, index).trimEnd();
  }
  return window;
}

export function makeCitation(
  book: CitationBookProjection,
  document: BookDocument,
  locator: EpubBookLocatorV1,
  evidenceType: EvidenceType,
  quote: string | null,
  sourceKind: "book_text" | "user_annotation" = "book_text",
  annotationId: string | null = null,
): Citation {
  return {
    sourceKind,
    evidenceType,
    bookId: book.id,
    bookTitle: book.title,
    authors: [...book.authors],
    chapterPath: structureAt(
      document,
      locator.position.sectionIndex,
      locator.position.start,
    )?.path ?? null,
    locator,
    quote: quote ? quote.slice(0, 320) : null,
    annotationId,
  };
}

export function structureAt(document: BookDocument, sectionIndex: number, offset: number) {
  return document.toc
    .filter(node => {
      const next = document.toc.slice(node.linearIndex + 1).find(candidate => candidate.level <= node.level);
      const last = document.sections[document.sections.length - 1];
      const endSection = node.endSectionIndex ?? (next ? next.sectionIndex : last.sectionIndex);
      const end = node.end ?? (next ? next.start : last.text.length);
      return (sectionIndex > node.sectionIndex || (sectionIndex === node.sectionIndex && offset >= node.start)) &&
        (sectionIndex < endSection || (sectionIndex === endSection && offset < end));
    })
    .sort((left, right) => right.level - left.level || right.linearIndex - left.linearIndex)[0] ?? null;
}

export function revisionsEqual(left: EpubBookLocatorV1["contentRevision"], document: BookDocument): boolean {
  const right = document.revision;
  return left.fileChecksum === right.fileChecksum
    && left.extractorVersion === right.extractorVersion
    && left.normalizationVersion === right.normalizationVersion;
}

export function requireOwnedBook(
  book: CitationBookProjection | null,
  field = "bookId",
): asserts book is CitationBookProjection {
  if (!book) {
    throw new ReaderToolException("BOOK_NOT_FOUND", "Book not found in the current user's library", field);
  }
}

export interface CitationBookProjection {
  id: number;
  title: string;
  authors: readonly string[];
}
