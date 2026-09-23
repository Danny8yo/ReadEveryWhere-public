import type { BookmarkRepositoryPort } from "../ports/bookmark-repository.port";
import type { ReadingStateChangePort } from "../../../application/ports/reading-state-change.port";

export class DeleteBookmarkUseCase {
  constructor(
    private readonly repository: BookmarkRepositoryPort,
    private readonly changes: ReadingStateChangePort,
  ) {}

  execute(userId: number, bookmarkId: number): void {
    this.changes.transact({ userId, changed: ["bookmarks"] }, () => {
      const existing = this.repository.findById(bookmarkId);
      if (!existing || existing.userId !== userId) {
        return { value: undefined, bookId: null, didChange: false };
      }
      const deleted = this.repository.deleteByIdAndUser(bookmarkId, userId);
      return deleted
        ? { value: undefined, bookId: deleted.bookId, didChange: true }
        : { value: undefined, bookId: null, didChange: false };
    });
  }
}
