export interface BookOwnershipQuery {
  userId: number;
  bookId: number;
}

export interface BookOwnershipPort {
  isOwnedByUser(query: Readonly<BookOwnershipQuery>): boolean;
}

export const BOOK_OWNERSHIP_PORT = Symbol(
  "INTELLIGENT_LIBRARY_BOOK_OWNERSHIP_PORT",
);
