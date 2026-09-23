import type { BookSelectionPort } from "../../../intelligent-library/public/book-selection.port";
import type { AnnotationSelectionResolverPort } from "../application/ports/annotation-selection-resolver.port";
export class BookContentSelectionAdapter implements AnnotationSelectionResolverPort {
  constructor(private readonly content: BookSelectionPort) {}
  resolveSelection(...args: Parameters<AnnotationSelectionResolverPort["resolveSelection"]>) {
    return this.content.resolveSelection(...args);
  }
  assertCurrent(...args: Parameters<AnnotationSelectionResolverPort["assertCurrent"]>) {
    this.content.assertCurrent(...args);
  }
}
