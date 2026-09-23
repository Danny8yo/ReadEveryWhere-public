import { ReadingStateError } from "../../../domain/reading-state.error";
import { Annotation, AnnotationType } from "../../domain/annotation.types";
import type { AnnotationRepositoryPort } from "../ports/annotation-repository.port";
import type { ReadingStateChangePort } from "../../../application/ports/reading-state-change.port";

export class UpdateAnnotationUseCase {
  constructor(
    private readonly annotationRepository: AnnotationRepositoryPort,
    private readonly changes: ReadingStateChangePort,
  ) {}

  execute(userId: number, annotationId: string, dto: {
    annotationType?: string;
    color?: string;
    note?: string | null;
    revision: number;
  }): Annotation {
    return this.changes.transact({ userId, changed: ["annotations"] }, () => {
      const result = this.annotationRepository.updateAnnotation({
        userId,
        annotationId,
        annotationType: dto.annotationType as AnnotationType | undefined,
        color: dto.color,
        note: dto.note,
        expectedRevision: dto.revision,
        updatedAt: Date.now(),
      });
      if (result.kind === "not_found") throw ReadingStateError.annotationNotFound();
      if (result.kind === "conflict") throw ReadingStateError.annotationConflict(result.current);
      if (result.kind !== "updated") throw ReadingStateError.internal();
      const didChange = dto.annotationType !== undefined || dto.color !== undefined || dto.note !== undefined;
      return { value: result.annotation, bookId: result.annotation.bookId, didChange };
    });
  }
}
