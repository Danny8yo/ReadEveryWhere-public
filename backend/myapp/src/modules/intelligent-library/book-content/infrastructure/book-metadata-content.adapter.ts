import { Inject, Injectable } from "@nestjs/common";
import type { BookMetadataContentInspection, BookMetadataContentPort, MetadataSection } from "../../public/book-metadata-content.port";
import { CATALOG_BOOK_VIEW_QUERY_PORT, type CatalogBookViewQueryPort } from "../../catalog/application/ports/catalog-book-view-query.port";
import { BookDocumentLoader } from "../application/book-document.loader";
import { resolveTocNodeRange } from "../application/toc-node-range.resolver";
import { ReaderToolException } from "../domain/reader-tool-error";

const EPUB_FORMAT = "epub" as const;

@Injectable()
export class BookMetadataContentAdapter implements BookMetadataContentPort {
  constructor(
    @Inject(CATALOG_BOOK_VIEW_QUERY_PORT)
    private readonly books: CatalogBookViewQueryPort,
    private readonly documents: BookDocumentLoader,
  ) {}

  async inspect(userId: number, bookId: number): Promise<BookMetadataContentInspection> {
    const book = this.books.getBook(userId, bookId);
    if (!book) throw new ReaderToolException("BOOK_NOT_FOUND", "Book not found in the current user's library", "bookId");
    if (book.format !== EPUB_FORMAT) {
      throw new ReaderToolException("UNSUPPORTED_FORMAT", "AI metadata extraction currently supports EPUB files only", "bookId");
    }
    const document = await this.documents.load(userId, bookId);
    return {
      book: {
        id: book.id,
        title: book.title,
        authors: [...book.authors],
        isbn: book.isbn,
        language: book.language ?? null,
        coverUrl: book.coverUrl,
        description: book.description,
        publisher: book.publisher,
        publishYear: book.publishYear,
        editionTag: book.editionTag,
      },
      format: EPUB_FORMAT,
      contentRevision: document.revision,
      sections: document.toc.map((node) => ({
        sectionId: node.nodeId,
        label: node.label,
        path: node.path,
        order: node.linearIndex,
        charCount: node.subtreeCharCount,
      })),
    };
  }

  async readSections(
    userId: number,
    bookId: number,
    sectionIds: readonly string[],
    options: { maxTotalChars: number; maxCharsPerSection: number },
  ): Promise<readonly MetadataSection[]> {
    const inspection = await this.inspect(userId, bookId);
    const selected = new Set(sectionIds);
    const document = await this.documents.load(userId, bookId);
    let remaining = options.maxTotalChars;
    const result: MetadataSection[] = [];
    for (const node of document.toc.filter((candidate) => selected.has(candidate.nodeId))) {
      if (remaining <= 0) break;
      const range = resolveTocNodeRange(document, node.nodeId);
      if (!range.readable) continue;
      const start = range.startLocator.position;
      const end = range.endLocator.position;
      const text = document.sections
        .filter((section) => section.sectionIndex >= start.sectionIndex && section.sectionIndex <= end.sectionIndex)
        .map((section) => {
          const from = section.sectionIndex === start.sectionIndex ? start.start : 0;
          const to = section.sectionIndex === end.sectionIndex ? end.end : section.text.length;
          return section.text.slice(from, to);
        })
        .join("")
        .slice(0, Math.min(options.maxCharsPerSection, remaining));
      if (!text) continue;
      result.push({ sectionId: node.nodeId, label: node.label, path: node.path, order: node.linearIndex, text });
      remaining -= text.length;
    }
    const latest = await this.documents.load(userId, bookId);
    if (inspection.contentRevision.fileChecksum !== latest.revision.fileChecksum) {
      throw new ReaderToolException("CONTENT_REVISION_MISMATCH", "Book content changed during metadata extraction", "bookId");
    }
    return result;
  }
}
