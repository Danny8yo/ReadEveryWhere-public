import type { EpubSelectionResolverPort } from "./ports/epub-selection-resolver.port";
import type { BookSelectionPort, BookSelectionRequest, VerifiedBookSelection } from "../../public/book-selection.port";
import type { CurrentBookArtifactFencePort } from "../../public/current-book-artifact-fence.port";
import type { BookSelectionSourcePort } from "./ports/book-selection-source.port";
import type { BookDocumentExtractorPort } from "./ports/book-document-extractor.port";
import { ReaderToolException } from "../domain/reader-tool-error";

export class ResolveBookSelectionService implements BookSelectionPort {
  constructor(private readonly source: BookSelectionSourcePort,
    private readonly fence: CurrentBookArtifactFencePort,
    private readonly extractor: BookDocumentExtractorPort, private readonly resolver: EpubSelectionResolverPort) {}
  async resolveSelection(userId: number, request: BookSelectionRequest): Promise<VerifiedBookSelection> {
    if (!request.scope || !Number.isSafeInteger(request.scope.bookId) || request.scope.bookId <= 0)
      throw new ReaderToolException("LOCATOR_INVALID", "A valid book scope is required");
    const { buffer, artifact } = await this.source.readOwnedEpubArtifact(userId, request.scope.bookId);
    const expectedScope = { ...request.scope, bookId: artifact.bookId, fileChecksum: artifact.fileChecksum,
      extractorVersion: this.extractor.extractorVersion, normalizationVersion: this.extractor.normalizationVersion };
    if (request.scope.fileChecksum !== expectedScope.fileChecksum
      || request.scope.extractorVersion !== expectedScope.extractorVersion
      || request.scope.normalizationVersion !== expectedScope.normalizationVersion)
      throw new ReaderToolException("CONTENT_REVISION_MISMATCH", "Reader bytes or parsing version differ from the current artifact");
    let resolved;
    try { resolved = await this.resolver.resolve(buffer, expectedScope, request); }
    catch (error) {
      if (!(error instanceof Error) || !("code" in error)) throw error;
      const reason = ["VERSION_MISMATCH", "CHECKSUM_MISMATCH"].includes(String(error.code))
        ? "CONTENT_REVISION_MISMATCH" : error.code === "QUOTE_MISMATCH" ? "TEXT_QUOTE_MISMATCH" : "LOCATOR_INVALID";
      throw new ReaderToolException(reason, error.message, "selection");
    }
    const result = { ...resolved, artifact };
    this.assertCurrent(userId, result);
    return result;
  }
  assertCurrent(userId: number, selection: VerifiedBookSelection): void {
    if (selection.scope.bookId !== selection.artifact.bookId || selection.scope.fileChecksum !== selection.artifact.fileChecksum
      || selection.scope.extractorVersion !== this.extractor.extractorVersion
      || selection.scope.normalizationVersion !== this.extractor.normalizationVersion)
      throw new ReaderToolException("CONTENT_REVISION_MISMATCH", "Selection content version is no longer current");
    this.fence.assertCurrent(userId, selection.artifact);
  }
}
