import type { LibraryBookView } from "../query-model/library-book.view";

export interface ApplyBookMetadataCommand {
  expectedVersion: number;
  title?: string;
  authors?: string[];
  isbn?: string;
  language?: string;
  coverUrl?: string;
  description?: string;
  publishYear?: number;
  publisher?: string;
  editionTag?: string;
  sourcePlatform?: string;
  sourceBookId?: string;
  sourceUrl?: string;
}

export interface ApplyBookMetadataPort {
  apply(userId: number, bookId: number, command: Readonly<ApplyBookMetadataCommand>): LibraryBookView;
}

export const APPLY_BOOK_METADATA_PORT = Symbol(
  "INTELLIGENT_LIBRARY_APPLY_BOOK_METADATA_PORT",
);
