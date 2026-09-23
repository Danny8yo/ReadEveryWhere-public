import { Injectable } from "@nestjs/common";
import { parseEpub } from "@readeverywhere/epub-core/node";
import { NORMALIZATION_VERSION, EPUB_EXTRACTOR_VERSION } from "@readeverywhere/epub-core";
import type { BookDocumentExtractorPort } from "../application/ports/book-document-extractor.port";
import type { BookDocument, ContentRevision } from "../domain/book-document.types";
import { EpubDocumentProjector } from "./epub-document.projector";

export const EPUB_NORMALIZATION_VERSION = NORMALIZATION_VERSION;

@Injectable()
export class EpubDocumentExtractor implements BookDocumentExtractorPort {
  readonly extractorVersion = EPUB_EXTRACTOR_VERSION;
  readonly normalizationVersion = EPUB_NORMALIZATION_VERSION;
  async extract(bookId: number, buffer: Buffer, revision: ContentRevision): Promise<BookDocument> {
    return new EpubDocumentProjector().project(bookId, revision, await parseEpub(buffer));
  }
}
