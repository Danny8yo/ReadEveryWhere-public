import type { BookDocument, ContentRevision } from "../../domain/book-document.types";

export interface BookDocumentCachePort {
  load(userId: number, bookId: number, revision: ContentRevision): Promise<BookDocument | null>;
  save(userId: number, document: BookDocument): Promise<void>;
}

export const BOOK_DOCUMENT_CACHE_PORT = Symbol(
  "INTELLIGENT_LIBRARY_BOOK_DOCUMENT_CACHE_PORT",
);
