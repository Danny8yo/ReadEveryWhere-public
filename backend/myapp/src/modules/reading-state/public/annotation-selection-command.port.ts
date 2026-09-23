import type { VerifiedBookSelection } from "../../intelligent-library/public/book-selection.port";
import type { Annotation, AnnotationType } from "../annotations/domain/annotation.types";
export interface AnnotationSelectionCommandReceipt {
  commandId: string;
  annotation: Annotation;
  readingStateVersion: number;
  createdAt: number;
}
export interface AnnotationSelectionCommandResult {
  receipt: AnnotationSelectionCommandReceipt;
  currentAnnotation: Annotation | null;
  replayed: boolean;
}
export type AnnotationSelectionTarget =
  | { kind: "append"; annotationId: string; expectedRevision: number }
  | { kind: "create"; annotationType: AnnotationType; color: string; bookHash: string; cfi: string; chapterLabel?: string };
export interface AnnotationSelectionCommand {
  commandId: string;
  /** Digest of the complete external apply request, including source conversation/turn and preview. */
  requestDigest: string;
  selection: VerifiedBookSelection;
  appendText: string;
  target: AnnotationSelectionTarget;
}
export const ANNOTATION_SELECTION_COMMAND_PORT = Symbol("ANNOTATION_SELECTION_COMMAND_PORT");
export interface AnnotationSelectionCommandPort {
  /** Call before looking up the turn or current book; successful receipts survive their deletion. */
  findReceipt(userId: number, commandId: string, requestDigest?: string): AnnotationSelectionCommandResult | null;
  execute(userId: number, input: AnnotationSelectionCommand): Promise<AnnotationSelectionCommandResult>;
}
