import type {
  BookDocument,
  ContentRevision,
  EpubBookLocatorV1,
} from "../book-content/domain/book-document.types";
import type {
  ReaderFocusHint,
  ResolvedReaderFocus,
} from "../book-content/application/use-cases/resolve-reader-focus.use-case";

export const BOOK_CONTENT_ACCESS_PORT = Symbol(
  "INTELLIGENT_LIBRARY_BOOK_CONTENT_ACCESS_PORT",
);

export interface BookContentAccessPort {
  loadDocument(userId: number, bookId: number): Promise<BookDocument>;
  getToc(
    userId: number,
    bookId: number,
    input: {
      mode: "outline" | "tree" | "navigation";
      cursor?: string;
      limit?: number;
      nodeIds?: string[];
    },
  ): Promise<unknown>;
  read(
    userId: number,
    input: {
      locator: EpubBookLocatorV1;
      endLocator?: EpubBookLocatorV1;
      direction?: "forward" | "backward" | "around";
      maxChars?: number;
    },
  ): Promise<unknown>;
  readFromToc(userId: number, bookId: number, input: { nodeIds?: string[]; cursor?: string }): Promise<unknown>;
  planTocRead(userId: number, bookId: number, input: { nodeIds?: string[]; cursor?: string }): Promise<{ normalizedCharCount: number }>;
  searchText(
    userId: number,
    bookId: number,
    input: { query: string; cursor?: string; limit?: number },
  ): Promise<unknown>;
  searchSemantically(userId: number, bookId: number): unknown;
  resolveTocNodeReadTarget(
    userId: number,
    bookId: number,
    input: { nodeId: string; direction?: "forward" | "backward" },
  ): Promise<{
    locator: EpubBookLocatorV1;
    endLocator: EpubBookLocatorV1;
    direction: "forward" | "backward";
    node: { nodeId: string; label: string; normalizedCharCount: number };
  }>;
  resolveReaderFocus(
    userId: number,
    input: {
      bookId: number;
      contentRevision: ContentRevision;
      readerFocus: ReaderFocusHint;
    },
  ): Promise<ResolvedReaderFocus>;
  replayRange(
    userId: number,
    input: {
      bookId: number;
      contentRevision: ContentRevision;
      sourceLocator: EpubBookLocatorV1;
    },
  ): Promise<{
    text: string;
    sourceTextHash: string;
    citation: { locator: EpubBookLocatorV1 };
  }>;
}
