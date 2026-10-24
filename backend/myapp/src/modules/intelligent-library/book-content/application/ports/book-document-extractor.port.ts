import type { BookDocument, ContentRevision } from "../../domain/book-document.types";
import type { ContentExecution } from "./content-execution";

export interface BookDocumentExtractorPort {
  readonly extractorVersion: string;
  readonly normalizationVersion: string;
  extract(bookId: number, buffer: Buffer, revision: ContentRevision, execution?: ContentExecution): Promise<BookDocument>;
}

export const BOOK_DOCUMENT_EXTRACTOR_PORT = Symbol(
  "INTELLIGENT_LIBRARY_BOOK_DOCUMENT_EXTRACTOR_PORT",
);
