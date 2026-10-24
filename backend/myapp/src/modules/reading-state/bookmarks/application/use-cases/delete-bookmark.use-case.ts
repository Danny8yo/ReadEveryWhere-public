import type { BookmarkRepositoryPort } from "../ports/bookmark-repository.port";
import type { ReadingStateChangePort } from "../../../application/ports/reading-state-change.port";
import { ReadingStateError } from "../../../domain/reading-state.error";

export class DeleteBookmarkUseCase {
  constructor(
    private readonly repository: BookmarkRepositoryPort,
    private readonly changes: ReadingStateChangePort,
  ) {}

  // 不存在、属于别人、已删除三种情况回复相同，不泄露别人的书签编号。
  execute(userId: number, bookmarkId: number): void {
    this.changes.transact({ userId, changed: ["bookmarks"] }, () => {
      const deleted = this.repository.deleteByIdAndUser(bookmarkId, userId);
      if (!deleted) throw ReadingStateError.bookmarkNotFound();
      return { value: undefined, bookId: deleted.bookId, didChange: true };
    });
  }
}
