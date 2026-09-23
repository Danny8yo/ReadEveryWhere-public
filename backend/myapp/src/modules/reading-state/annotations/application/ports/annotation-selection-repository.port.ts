import type { Annotation } from "../../domain/annotation.types";
import type { AnnotationSelectionCommand, AnnotationSelectionCommandResult } from "../../../public/annotation-selection-command.port";
export interface AnnotationSelectionRepositoryPort {
  findReceipt(userId: number, commandId: string, requestDigest?: string): AnnotationSelectionCommandResult | null;
  commit(userId: number, input: AnnotationSelectionCommand, validatedAnnotation: Annotation | null): AnnotationSelectionCommandResult;
}
export const ANNOTATION_SELECTION_REPOSITORY_PORT = Symbol("ANNOTATION_SELECTION_REPOSITORY_PORT");
