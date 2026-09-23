import type {
  Annotation,
  CreateAnnotationInput,
  UpdateAnnotationInput,
  AnnotationWriteResult,
} from "../../domain/annotation.types";

export interface AnnotationRepositoryPort {
  create(input: CreateAnnotationInput & { createdAt: number; updatedAt: number }): Annotation;
  findById(id: string): Annotation | null;
  findByBook(userId: number, bookId: number): Annotation[];
  findByIdempotencyKey(
    userId: number,
    bookHash: string,
    location: string,
    textContent: string,
  ): Annotation | null;
  updateAnnotation(input: UpdateAnnotationInput & { updatedAt: number }): AnnotationWriteResult;
  deleteAnnotation(id: string, userId: number, expectedRevision: number): AnnotationWriteResult;
}

export const ANNOTATION_REPOSITORY_PORT = Symbol(
  "READING_STATE_ANNOTATION_REPOSITORY_PORT",
);
