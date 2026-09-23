import type { BookOwnershipPort } from "../../../../intelligent-library/public";
import { ReadingStateError } from "../../../domain/reading-state.error";
import { Bookmark, CreateBookmarkInput } from "../../domain/bookmark.types";
import type { BookmarkRepositoryPort } from "../ports/bookmark-repository.port";
import type { ReadingStateChangePort } from "../../../application/ports/reading-state-change.port";

export class CreateBookmarkUseCase {
  constructor(
    private readonly repository: BookmarkRepositoryPort,
    private readonly bookOwnership: BookOwnershipPort,
    private readonly changes: ReadingStateChangePort,
  ) {}

  execute(userId: number, input: Omit<CreateBookmarkInput, "userId">): Bookmark {
    // 归属校验：书签只能挂在属于当前用户的书上，避免越权写入与 book_id 存在性枚举。
    if (!this.bookOwnership.isOwnedByUser({ userId, bookId: input.bookId })) {
      throw ReadingStateError.bookNotFound();
    }
    const fraction = Number.isFinite(input.fraction)
      ? Math.min(1, Math.max(0, input.fraction))
      : 0;
    return this.changes.transact({ userId, changed: ["bookmarks"] }, () => {
      const result = this.repository.create({
        userId,
        ...input,
        fraction,
        now: Date.now(),
      });
      return { value: result.bookmark, bookId: input.bookId, didChange: result.created };
    });
  }
}
