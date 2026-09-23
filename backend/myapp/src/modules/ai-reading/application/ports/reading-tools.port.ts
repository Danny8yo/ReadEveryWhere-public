import type { BookScope } from "../../domain";

export interface ContentRevision {
  fileChecksum: string;
  extractorVersion: string;
  normalizationVersion: string;
}

export interface EpubBookLocatorV1 {
  version: 1;
  bookId: number;
  contentRevision: ContentRevision;
  position: {
    kind: "epub_text";
    sectionIndex: number;
    start: number;
    end: number;
  };
  textQuote?: { exact: string; prefix?: string; suffix?: string };
}

export type ReaderToolErrorCode =
  | "BOOK_NOT_FOUND"
  | "BOOK_FILE_MISSING"
  | "UNSUPPORTED_FORMAT"
  | "EXTRACTION_FAILED"
  | "CONTENT_REVISION_MISMATCH"
  | "LOCATOR_INVALID"
  | "LOCATOR_OUT_OF_RANGE"
  | "READING_TARGET_ALREADY_REACHED"
  | "TEXT_QUOTE_MISMATCH"
  | "CURSOR_INVALID"
  | "TOC_REQUEST_INVALID"
  | "TOC_NODE_NOT_FOUND"
  | "TOC_NODE_NOT_READABLE"
  | "TOC_NODE_TOO_LARGE"
  | "TOC_TREE_TOO_LARGE"
  | "REFERENCE_UNRESOLVED"
  | "QUERY_INVALID"
  | "INDEX_NOT_CONFIGURED";

export interface ReadingToolExecution {
  output: unknown;
  readSource?: {
    text: string;
    segments: Array<{
      textStart: number;
      textEnd: number;
      citation: Record<string, unknown>;
    }>;
  };
}

export interface ReadingToolsPort {
  inspectOwnedBook(userId: number, bookId: number): Promise<unknown>;
  preflight(scope: BookScope): Promise<unknown>;
  planTocRead(
    scope: BookScope,
    input: { nodeIds?: string[]; cursor?: string },
  ): Promise<{ normalizedCharCount: number }>;
  execute(scope: BookScope, toolName: string, argumentsValue: unknown): Promise<ReadingToolExecution>;
  resolveReaderFocus(
    userId: number,
    input: {
      bookId: number;
      contentRevision: ContentRevision;
      readerFocus: { sectionIndex: number; chapterLabel?: string };
    },
  ): Promise<{
    sectionIndex: number;
    tocNodeId: string;
    chapterLabel: string;
    chapterPath: string;
    startLocator: EpubBookLocatorV1;
    endLocator: EpubBookLocatorV1;
  }>;
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
