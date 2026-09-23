export interface CatalogBookDeletionPort {
  deleteOne(ownerId: number, bookId: number, cleanupAfter: string, now: string): boolean;
  deleteMany(ownerId: number, bookIds: number[], cleanupAfter: string, now: string): number[];
}

export const CATALOG_BOOK_DELETION_PORT = Symbol(
  "INTELLIGENT_LIBRARY_CATALOG_BOOK_DELETION_PORT",
);
