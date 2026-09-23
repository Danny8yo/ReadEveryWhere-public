import { SelectionSnapshot } from "./selection-qa.types";
export type AnnotationTarget =
  | { kind: "append"; annotationId: string; expectedRevision: number }
  | {
      kind: "create";
      annotationType: "highlight" | "underline" | "squiggly";
      color: string;
      cfi: string;
      chapterLabel?: string;
    };
export interface ApplyAnnotationInput {
  commandId: string;
  appendText: string;
  target: AnnotationTarget;
}
export interface AnnotationApplicationResult {
  receipt: {
    commandId: string;
    annotation: { id: string; revision: number; note: string | null };
    readingStateVersion: number;
    createdAt: number;
  };
  currentAnnotation: {
    id: string;
    revision: number;
    note: string | null;
  } | null;
  replayed: boolean;
}
export interface AnnotationApplicationPort {
  findReceipt(
    userId: number,
    commandId: string,
    digest?: string,
  ): AnnotationApplicationResult | null;
  execute(
    userId: number,
    input: ApplyAnnotationInput & {
      requestDigest: string;
      selection: SelectionSnapshot;
    },
  ): Promise<AnnotationApplicationResult>;
}
