import { Annotation, ListAnnotationsInput } from "../../domain/annotation.types";
import type { AnnotationRepositoryPort } from "../ports/annotation-repository.port";

export class ListAnnotationsUseCase {
  constructor(private readonly annotationRepository: AnnotationRepositoryPort) {}

  execute(userId: number, input: ListAnnotationsInput): Annotation[] {
    const annotations = this.annotationRepository.findByBook(userId, input.bookId);

    let results = annotations;
    if (input.type) {
      results = results.filter((a) => a.annotationType === input.type);
    }
    if (input.hasNote === true) {
      results = results.filter((a) => a.note !== null);
    } else if (input.hasNote === false) {
      results = results.filter((a) => a.note === null);
    }

    return results;
  }
}
