import type { CitationBookProjection } from "../reader-tool.utils";

export interface BookContentSourcePort {
  findOwnedBook(userId: number, bookId: number): CitationBookProjection | null;
  readOwnedEpub(userId: number, bookId: number): Promise<Buffer>;
}

export const BOOK_CONTENT_SOURCE_PORT = Symbol(
  "INTELLIGENT_LIBRARY_BOOK_CONTENT_SOURCE_PORT",
);
