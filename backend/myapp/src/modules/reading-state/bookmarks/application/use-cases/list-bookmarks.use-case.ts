import { Bookmark } from "../../domain/bookmark.types";
import type { BookmarkRepositoryPort } from "../ports/bookmark-repository.port";

export class ListBookmarksUseCase {
  constructor(private readonly repository: BookmarkRepositoryPort) {}

  execute(userId: number, bookId: number): Bookmark[] {
    return this.repository.listByUserBook(userId, bookId);
  }
}
