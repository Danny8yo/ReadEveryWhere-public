import type { Bookmark, CreateBookmarkInput } from "../../domain/bookmark.types";

export interface BookmarkRepositoryPort {
  create(input: CreateBookmarkInput & { now: number }): { bookmark: Bookmark; created: boolean };
  findById(id: number): Bookmark | null;
  listByUserBook(userId: number, bookId: number): Bookmark[];
  deleteByIdAndUser(id: number, userId: number): Bookmark | null;
}

export const BOOKMARK_REPOSITORY_PORT = Symbol(
  "READING_STATE_BOOKMARK_REPOSITORY_PORT",
);
