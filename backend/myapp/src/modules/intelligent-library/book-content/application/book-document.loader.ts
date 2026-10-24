import { createHash } from "node:crypto";
import type { BookDocument, ContentRevision } from "../domain/book-document.types";
import { ReaderToolException } from "../domain/reader-tool-error";
import type { BookContentSourcePort } from "./ports/book-content-source.port";
import type { BookDocumentCachePort } from "./ports/book-document-cache.port";
import type { BookDocumentExtractorPort } from "./ports/book-document-extractor.port";
import { checkContentExecution, type ContentExecution } from "./ports/content-execution";

export class BookDocumentLoader {
  private readonly memoryCache = new Map<string, BookDocument>();
  private readonly inFlight = new Map<string, Promise<BookDocument>>();

  constructor(
    private readonly source: BookContentSourcePort,
    private readonly extractor: BookDocumentExtractorPort,
    private readonly cacheRepository: BookDocumentCachePort,
  ) {}

  async load(userId: number, bookId: number, execution?: ContentExecution): Promise<BookDocument> {
    checkContentExecution(execution);
    const buffer = await this.source.readOwnedEpub(userId, bookId);
    checkContentExecution(execution);

    const revision: ContentRevision = {
      fileChecksum: `sha256:${createHash("sha256").update(buffer).digest("hex")}`,
      extractorVersion: this.extractor.extractorVersion,
      normalizationVersion: this.extractor.normalizationVersion,
    };
    const key = `${userId}:${bookId}:${revision.fileChecksum}:${revision.extractorVersion}:${revision.normalizationVersion}`;
    const memory = this.memoryCache.get(key);
    if (memory) return memory;

    // Cancellable consumers own their worker. Cancelling one must not stop an
    // unrelated legacy consumer sharing an in-flight extraction.
    if (execution) return this.loadOrExtract(userId, bookId, buffer, revision, key, execution);

    const current = this.inFlight.get(key);
    if (current) return current;

    const promise = this.loadOrExtract(userId, bookId, buffer, revision, key);
    this.inFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async loadOrExtract(
    userId: number,
    bookId: number,
    buffer: Buffer,
    revision: ContentRevision,
    key: string,
    execution?: ContentExecution,
  ): Promise<BookDocument> {
    const cached = await this.cacheRepository.load(userId, bookId, revision);
    checkContentExecution(execution);
    if (cached) {
      this.memoryCache.set(key, cached);
      return cached;
    }

    try {
      const document = await this.extractor.extract(bookId, buffer, revision, execution);
      checkContentExecution(execution);
      await this.cacheRepository.save(userId, document);
      this.memoryCache.set(key, document);
      return document;
    } catch (error) {
      checkContentExecution(execution);
      if (error instanceof ReaderToolException) throw error;
      const message = error instanceof Error ? error.message : "Unknown EPUB extraction error";
      throw new ReaderToolException("EXTRACTION_FAILED", message);
    }
  }
}
