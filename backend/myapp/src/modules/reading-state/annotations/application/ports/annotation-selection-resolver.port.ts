import type { BookSelectionRequest, VerifiedBookSelection } from "../../../../intelligent-library/public/book-selection.port";
/** ReadingState-owned dependency; implementation delegates to the content module. */
export interface AnnotationSelectionResolverPort {
  resolveSelection(userId: number, request: BookSelectionRequest): Promise<VerifiedBookSelection>;
  assertCurrent(userId: number, selection: VerifiedBookSelection): void;
}
export const ANNOTATION_SELECTION_RESOLVER_PORT = Symbol("ANNOTATION_SELECTION_RESOLVER_PORT");
