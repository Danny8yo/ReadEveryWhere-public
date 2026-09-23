import { Injectable } from "@nestjs/common";
import { AppException } from "../../../../platform/http/app-exception";
import { BookDocumentLoader } from "../../book-content/application/book-document.loader";
import { makeLocator } from "../../book-content/application/reader-tool.utils";
import type { CatalogBookViewQueryPort } from "../../catalog/application/ports/catalog-book-view-query.port";
import type { BookContentCatalogPort } from "../../catalog/application/ports/book-content-catalog.port";
import type {
  BookAnalysisContentPort,
  BookAnalysisInspection,
  RepresentativeSampleRequest,
} from "../application/ports/book-analysis-content.port";
import type {
  BookAnalysisLibraryPort,
  OwnedBookAnalysisSource,
} from "../application/ports/book-analysis-library.port";
import type { ClassificationSample } from "../application/ports/book-classifier.port";
import { revisionsEqual } from "../domain/book-reading-profile-candidate";

const MAX_CLASSIFICATION_TOC_NODES = 200;

@Injectable()
export class BookAnalysisSourceAdapter
implements BookAnalysisContentPort, BookAnalysisLibraryPort {
  constructor(
    private readonly books: CatalogBookViewQueryPort,
    private readonly catalogFiles: BookContentCatalogPort,
    private readonly documents: BookDocumentLoader,
  ) {}

  findOwnedAnalysisSource(userId: number, bookId: number): OwnedBookAnalysisSource | null {
    const book = this.books.getBook(userId, bookId);
    if (!book) return null;
    const file = this.catalogFiles.findReadableFile(userId, bookId);
    return {
      bookId,
      userId,
      fileName: file?.fileName ?? null,
      mimeType: file?.mimeType ?? null,
      downloadStatus: file?.downloadStatus ?? null,
    };
  }

  requireOwned(userId: number, bookId: number): unknown {
    const book = this.books.getBook(userId, bookId);
    if (!book) {
      throw new AppException(404, 40401, "Book not found", {
        field: "bookId",
        reason: "BOOK_NOT_FOUND",
      });
    }
    return book;
  }

  async inspect(userId: number, bookId: number): Promise<BookAnalysisInspection> {
    const book = this.requireOwned(userId, bookId) as NonNullable<ReturnType<CatalogBookViewQueryPort["getBook"]>>;
    const profile = book.readingProfile;
    if (!profile) throw new Error(`Book ${bookId} is missing its reading profile`);
    const document = await this.documents.load(userId, bookId);
    return {
      baseProfileVersion: profile.profileVersion,
      book: {
        bookId,
        title: book.title,
        authors: [...book.authors],
        description: book.description,
        format: "epub",
      },
      contentRevision: { ...document.revision },
      toc: document.toc.slice(0, MAX_CLASSIFICATION_TOC_NODES).map((node) => ({
        nodeId: node.nodeId,
        label: node.label,
        path: node.path,
      })),
      contentStats: {
        sectionCount: document.sections.length,
        tocNodeCount: document.toc.length,
        charCount: document.sections.reduce((total, section) => total + section.charCount, 0),
      },
    };
  }

  async currentRevision(userId: number, bookId: number) {
    const document = await this.documents.load(userId, bookId);
    return { ...document.revision };
  }

  async sampleRepresentativeText(input: RepresentativeSampleRequest): Promise<ClassificationSample[]> {
    const document = await this.documents.load(input.userId, input.bookId);
    if (!revisionsEqual(document.revision, input.contentRevision)) {
      throw new AppException(409, 40004, "Book content changed during analysis", {
        field: "contentRevision",
        reason: "CONTENT_REVISION_MISMATCH",
      });
    }
    const sections = document.sections.filter((section) => section.text.trim().length > 0);
    const count = Math.min(Math.max(0, input.maxSections), sections.length);
    if (count === 0) return [];

    const indexes = count === 1
      ? [0]
      : Array.from({ length: count }, (_, index) => (
        Math.round(index * (sections.length - 1) / (count - 1))
      ));
    let remaining = input.maxTotalCharacters;
    const samples: ClassificationSample[] = [];
    for (const index of [...new Set(indexes)]) {
      if (remaining <= 0) break;
      const section = sections[index];
      const length = Math.min(
        section.text.length,
        input.maxCharactersPerSection,
        remaining,
      );
      if (length <= 0) continue;
      const locator = makeLocator(document, section.sectionIndex, 0, length);
      samples.push({
        text: section.text.slice(0, length),
        locator,
        chapterPath: locator.structure?.path ?? null,
      });
      remaining -= length;
    }
    return samples;
  }
}
