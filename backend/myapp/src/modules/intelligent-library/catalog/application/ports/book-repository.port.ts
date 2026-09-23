import type { Book, BookId } from "../../domain/book";

export type BookSaveResult = "saved" | "conflict" | "not_found";

export interface BookRepositoryPort {
  isOwnedBy(ownerId: number, bookId: BookId): boolean;
  findById(ownerId: number, bookId: BookId): Book | null;
  insert(book: Book): BookId;
  save(book: Book, expectedVersion: number): BookSaveResult;
  delete(ownerId: number, bookId: BookId): boolean;
  findOwnedIds(ownerId: number, bookIds: BookId[]): BookId[];
  deleteMany(ownerId: number, bookIds: BookId[]): void;
}

export const BOOK_REPOSITORY_PORT = Symbol("INTELLIGENT_LIBRARY_BOOK_REPOSITORY_PORT");
