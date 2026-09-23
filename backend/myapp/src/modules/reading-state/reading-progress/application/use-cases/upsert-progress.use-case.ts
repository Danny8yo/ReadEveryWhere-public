import type { BookOwnershipPort } from "../../../../intelligent-library/public";
import { ReadingStateError } from "../../../domain/reading-state.error";
import { ReadingProgress, UpsertProgressInput } from "../../domain/reading-progress.types";
import type { ReadingProgressRepositoryPort } from "../ports/reading-progress-repository.port";
import type { ReadingStateChangePort } from "../../../application/ports/reading-state-change.port";

export class UpsertProgressUseCase {
  constructor(
    private readonly repository: ReadingProgressRepositoryPort,
    private readonly bookOwnership: BookOwnershipPort,
    private readonly changes: ReadingStateChangePort,
  ) {}

  execute(userId: number, input: Omit<UpsertProgressInput, "userId">): ReadingProgress {
    // 归属校验：只能为属于当前用户的书写进度，避免越权写入与 book_id 存在性枚举。
    if (!this.bookOwnership.isOwnedByUser({ userId, bookId: input.bookId })) {
      throw ReadingStateError.bookNotFound();
    }
    const fraction = Number.isFinite(input.fraction)
      ? Math.min(1, Math.max(0, input.fraction))
      : 0;
    return this.changes.transact(
      { userId, changed: ["progress"], sourceDeviceId: input.deviceId },
      () => {
        const result = this.repository.upsert({
          userId,
          ...input,
          fraction,
          now: Date.now(),
        });
        return {
          value: result.progress,
          bookId: input.bookId,
          didChange: result.changed,
        };
      });
  }
}
