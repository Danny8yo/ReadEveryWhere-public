import { ReadingStateError } from "../../../domain/reading-state.error";
import type { AnnotationRepositoryPort } from "../ports/annotation-repository.port";
import type { ReadingStateChangePort } from "../../../application/ports/reading-state-change.port";

export class DeleteAnnotationUseCase {
  constructor(
    private readonly annotationRepository: AnnotationRepositoryPort,
    private readonly changes: ReadingStateChangePort,
  ) {}

  execute(userId: number, annotationId: string, expectedRevision: number): void {
    this.changes.transact({ userId, changed: ["annotations"] }, () => {
      const result = this.annotationRepository.deleteAnnotation(annotationId, userId, expectedRevision);
      if (result.kind === "not_found") throw ReadingStateError.annotationNotFound();
      if (result.kind === "conflict") throw ReadingStateError.annotationConflict(result.current);
      if (result.kind !== "deleted") throw ReadingStateError.internal();
      return { value: undefined, bookId: result.annotation.bookId, didChange: true };
    });
  }
}
