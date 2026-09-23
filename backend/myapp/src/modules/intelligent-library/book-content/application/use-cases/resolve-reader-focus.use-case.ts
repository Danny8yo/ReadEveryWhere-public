import type {
  BookDocument,
  ContentRevision,
  DocumentTocNode,
  EpubBookLocatorV1,
} from "../../domain/book-document.types";
import { ReaderToolException } from "../../domain/reader-tool-error";
import { BookDocumentLoader } from "../book-document.loader";
import { makeLocator, revisionsEqual } from "../reader-tool.utils";

export interface ReaderFocusHint {
  sectionIndex: number;
  chapterLabel?: string;
}

export interface ResolvedReaderFocus {
  sectionIndex: number;
  tocNodeId: string;
  chapterLabel: string;
  chapterPath: string;
  startLocator: EpubBookLocatorV1;
  endLocator: EpubBookLocatorV1;
}

export class ResolveReaderFocusUseCase {
  constructor(private readonly documentLoader: BookDocumentLoader) {}

  async execute(
    userId: number,
    input: {
      bookId: number;
      contentRevision: ContentRevision;
      readerFocus: ReaderFocusHint;
    },
  ): Promise<ResolvedReaderFocus> {
    this.requireValidSectionIndex(input.readerFocus.sectionIndex);
    const document = await this.documentLoader.load(userId, input.bookId);
    if (document.bookId !== input.bookId) {
      throw new ReaderToolException("LOCATOR_INVALID", "Loaded document does not match the requested book", "bookId");
    }
    if (!revisionsEqual(input.contentRevision, document)) {
      throw new ReaderToolException(
        "CONTENT_REVISION_MISMATCH",
        "Reader focus belongs to a different content revision",
        "contentRevision",
      );
    }

    const section = document.sections.find(
      (candidate) => candidate.sectionIndex === input.readerFocus.sectionIndex,
    );
    if (!section) this.unresolved();

    const node = document.toc
      .filter((candidate) => this.coversSection(candidate, input.readerFocus.sectionIndex))
      .sort((left, right) => (
        right.level - left.level
        || right.sectionIndex - left.sectionIndex
        || right.start - left.start
        || left.linearIndex - right.linearIndex
      ))[0];
    if (!node) this.unresolved();

    const boundary = this.readableNodeEnd(document, node);
    return {
      sectionIndex: input.readerFocus.sectionIndex,
      tocNodeId: node.nodeId,
      chapterLabel: node.label,
      chapterPath: node.path,
      startLocator: makeLocator(document, node.sectionIndex, node.start, node.start),
      endLocator: makeLocator(document, boundary.sectionIndex, boundary.end, boundary.end),
    };
  }

  private requireValidSectionIndex(sectionIndex: number): void {
    if (!Number.isSafeInteger(sectionIndex) || sectionIndex < 0) {
      throw new ReaderToolException(
        "REFERENCE_UNRESOLVED",
        "Reader focus does not identify a current EPUB section",
        "readerFocus.sectionIndex",
      );
    }
  }

  private coversSection(node: DocumentTocNode, sectionIndex: number): boolean {
    const endSectionIndex = node.endSectionIndex ?? node.sectionIndex;
    const end = node.end ?? node.start;
    if (sectionIndex < node.sectionIndex || sectionIndex > endSectionIndex) return false;
    if (sectionIndex === endSectionIndex && end === 0 && sectionIndex !== node.sectionIndex) return false;
    return sectionIndex !== node.sectionIndex || node.start >= 0;
  }

  private readableNodeEnd(document: BookDocument, node: DocumentTocNode): { sectionIndex: number; end: number } {
    const sectionIndex = node.endSectionIndex ?? node.sectionIndex;
    const section = document.sections.find((candidate) => candidate.sectionIndex === sectionIndex);
    const end = node.end ?? section?.text.length;
    if (!section || end === undefined || end < 0 || end > section.text.length) this.unresolved();
    if (end === 0 && node.subtreeCharCount > 0 && sectionIndex > node.sectionIndex) {
      const previous = [...document.sections]
        .filter((candidate) => (
          candidate.sectionIndex >= node.sectionIndex
          && candidate.sectionIndex < sectionIndex
          && candidate.text.length > 0
        ))
        .sort((left, right) => right.sectionIndex - left.sectionIndex)[0];
      if (previous) return { sectionIndex: previous.sectionIndex, end: previous.text.length };
    }
    return { sectionIndex, end };
  }

  private unresolved(): never {
    throw new ReaderToolException(
      "REFERENCE_UNRESOLVED",
      "Reader focus cannot be resolved to a current table-of-contents range",
      "readerFocus.sectionIndex",
    );
  }
}
