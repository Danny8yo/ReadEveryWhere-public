import type { AnnotationSelectionResolverPort } from "../ports/annotation-selection-resolver.port";
import type { AnnotationSelectionCommand as Command } from "../../../public/annotation-selection-command.port";
type VerifiedBookSelection = Command["selection"];
import type { AnnotationRepositoryPort } from "../ports/annotation-repository.port";
import type { AnnotationSelectionRepositoryPort } from "../ports/annotation-selection-repository.port";
import type { AnnotationSelectionCommandPort, AnnotationSelectionCommand } from "../../../public/annotation-selection-command.port";
import { ReadingStateError } from "../../../domain/reading-state.error";

export class ApplySelectionAnnotationUseCase implements AnnotationSelectionCommandPort {
  constructor(private readonly receipts: AnnotationSelectionRepositoryPort,
    private readonly annotations: AnnotationRepositoryPort, private readonly selections: AnnotationSelectionResolverPort) {}
  findReceipt(userId: number, commandId: string, requestDigest?: string) {
    return this.receipts.findReceipt(userId, commandId, requestDigest);
  }
  async execute(userId: number, input: AnnotationSelectionCommand) {
    const replay = this.findReceipt(userId, input.commandId, input.requestDigest);
    if (replay) return replay;
    if (!input.commandId || input.commandId.length > 128 || !/^[a-f0-9]{64}$/i.test(input.requestDigest)
      || !input.appendText.trim() || input.appendText.length > 100_000)
      throw new ReadingStateError("ANNOTATION_SELECTION_INVALID", "Invalid annotation command or preview");
    this.selections.assertCurrent(userId, input.selection);
    const selection = await this.selections.resolveSelection(userId, {
      scope: input.selection.scope, source: input.selection.source, displayedQuote: input.selection.displayedQuote,
    });
    this.requireSameSelection(input.selection, selection);
    let annotation = null;
    let cfi: string;
    if (input.target.kind === "append") {
      annotation = this.annotations.findById(input.target.annotationId);
      if (!annotation || annotation.userId !== userId) throw ReadingStateError.annotationNotFound();
      if (annotation.revision !== input.target.expectedRevision) throw ReadingStateError.annotationConflict(annotation);
      if (annotation.bookId !== selection.scope.bookId || annotation.locationType !== "epubcfi")
        throw new ReadingStateError("ANNOTATION_SELECTION_INVALID", "Annotation belongs to another book or format");
      // Existing reader annotation labels were trimmed. They are not exact DOM quotes.
      if (annotation.textContent.trim() !== selection.displayedQuote.trim())
        throw new ReadingStateError("ANNOTATION_SELECTION_INVALID", "Persisted annotation label differs from the selection");
      cfi = annotation.location;
    } else {
      if (!["highlight", "underline", "squiggly"].includes(input.target.annotationType)
        || !input.target.color || !input.target.bookHash || !input.target.cfi)
        throw new ReadingStateError("ANNOTATION_SELECTION_INVALID", "Invalid annotation creation fields");
      cfi = input.target.cfi;
    }
    // Resolve the stored/display CFI against the same authorized bytes. Equal text or
    // equal CFI strings never substitute for physical section and canonical range identity.
    const targetSelection = await this.selections.resolveSelection(userId, {
      scope: selection.scope, cfi, displayedQuote: selection.displayedQuote,
    });
    this.requireSameSelection(selection, targetSelection);
    return this.receipts.commit(userId, { ...input, selection }, annotation);
  }
  private requireSameSelection(expected: VerifiedBookSelection, actual: VerifiedBookSelection) {
    const keys = ["bookId", "fileChecksum", "extractorVersion", "normalizationVersion", "sectionIndex", "href"] as const;
    const pointsEqual = (a: VerifiedBookSelection["source"]["start"], b: VerifiedBookSelection["source"]["start"]) =>
      a.offset === b.offset && a.path.length === b.path.length && a.path.every((value, index) => value === b.path[index]);
    if (keys.some(key => expected.scope[key] !== actual.scope[key])
      || expected.artifact.artifactId !== actual.artifact.artifactId
      || expected.artifact.bookId !== actual.artifact.bookId || expected.artifact.fileChecksum !== actual.artifact.fileChecksum
      || expected.start !== actual.start || expected.end !== actual.end
      || !pointsEqual(expected.source.start, actual.source.start) || !pointsEqual(expected.source.end, actual.source.end))
      throw new ReadingStateError("ANNOTATION_SELECTION_INVALID", "Annotation location does not identify the original selection");
  }
}
