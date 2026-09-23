export interface BookSourceReferenceQuery {
  userId: number;
  bookId: number;
}

export interface BookSourceReferenceProjection {
  sourceBookId: string;
  hash: string | null;
}

export interface BookSourceReferenceQueryPort {
  findForDownload(query: Readonly<BookSourceReferenceQuery>): BookSourceReferenceProjection | null;
}

export const BOOK_SOURCE_REFERENCE_QUERY_PORT = Symbol(
  "INTELLIGENT_LIBRARY_BOOK_SOURCE_REFERENCE_QUERY_PORT",
);
