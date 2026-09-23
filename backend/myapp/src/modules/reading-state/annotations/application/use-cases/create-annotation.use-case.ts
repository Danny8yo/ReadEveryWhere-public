import { randomUUID } from "node:crypto";
import type { BookOwnershipPort } from "../../../../intelligent-library/public";
import { ReadingStateError } from "../../../domain/reading-state.error";
import { Annotation, CreateAnnotationInput } from "../../domain/annotation.types";
import type { AnnotationRepositoryPort } from "../ports/annotation-repository.port";
import type { ReadingStateChangePort } from "../../../application/ports/reading-state-change.port";

export class CreateAnnotationUseCase {
  constructor(
    private readonly annotationRepository: AnnotationRepositoryPort,
    private readonly bookOwnership: BookOwnershipPort,
    private readonly changes: ReadingStateChangePort,
  ) {}

  execute(userId: number, dto: Omit<CreateAnnotationInput, "id" | "userId">): Annotation {
    const now = Date.now();

    // 归属校验：只能对属于当前用户的书创建标注，避免越权写入与 book_id 存在性枚举。
    if (!this.bookOwnership.isOwnedByUser({ userId, bookId: dto.bookId })) {
      throw ReadingStateError.bookNotFound();
    }

    return this.changes.transact({ userId, changed: ["annotations"] }, () => {
      const existing = this.annotationRepository.findByIdempotencyKey(
        userId, dto.bookHash, dto.location, dto.textContent,
      );
      if (existing && existing.note === dto.note && existing.annotationType === dto.annotationType && existing.color === dto.color && (now - existing.updatedAt) < 5000) {
        return { value: existing, bookId: dto.bookId, didChange: false };
      }

      const id = Date.now().toString(36) + randomUUID().slice(0, 12);
      const created = this.annotationRepository.create({
        id,
        userId,
        ...dto,
        createdAt: now,
        updatedAt: now,
      });
      return { value: created, bookId: dto.bookId, didChange: true };
    });
  }
}
