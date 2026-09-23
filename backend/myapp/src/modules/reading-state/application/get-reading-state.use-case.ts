import type { BookOwnershipPort } from "../../intelligent-library/public";
import type { AnnotationRepositoryPort } from "../annotations/application/ports/annotation-repository.port";
import type { BookmarkRepositoryPort } from "../bookmarks/application/ports/bookmark-repository.port";
import { ReadingStateError } from "../domain/reading-state.error";
import type { ReadingProgressRepositoryPort } from "../reading-progress/application/ports/reading-progress-repository.port";
import type { ReadingStateVersionPort } from "./ports/reading-state-version.port";

export class GetReadingStateUseCase {
  constructor(
    private readonly progress: ReadingProgressRepositoryPort,
    private readonly bookmarks: BookmarkRepositoryPort,
    private readonly annotations: AnnotationRepositoryPort,
    private readonly versions: ReadingStateVersionPort,
    private readonly ownership: BookOwnershipPort,
  ) {}

  execute(userId: number, bookId: number) {
    if (!this.ownership.isOwnedByUser({ userId, bookId })) {
      throw ReadingStateError.bookNotFound();
    }
    return {
      revision: this.versions.getRevision(userId, bookId),
      progress: this.progress.findByUserBook(userId, bookId),
      bookmarks: this.bookmarks.listByUserBook(userId, bookId),
      annotations: this.annotations.findByBook(userId, bookId),
    };
  }
}
