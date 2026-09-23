import { CatalogError } from "../../domain/catalog.error";
import type { LibraryBookView } from "../query-model/library-book.view";
import { Book } from "../../domain/book";
import { normalizeAuthors, normalizeOptionalString, normalizeTitle } from "../../domain/library.utils";
import type { CreateBookCommand } from "../catalog.commands";
import type { BookDuplicateQueryPort } from "../ports/book-duplicate-query.port";
import type { BookRepositoryPort } from "../ports/book-repository.port";
import type { CatalogBookViewQueryPort } from "../ports/catalog-book-view-query.port";

export class CreateBookUseCase {
  constructor(
    private readonly books: BookRepositoryPort,
    private readonly duplicates: BookDuplicateQueryPort,
    private readonly views: CatalogBookViewQueryPort,
  ) {}

  execute(userId: number, dto: CreateBookCommand): LibraryBookView {
    const title = normalizeOptionalString(dto.title);
    if (!title) {
      throw CatalogError.validation("title", "title is required");
    }

    const authors = normalizeAuthors(dto.authors ?? []);
    if (authors.length === 0) {
      throw CatalogError.validation("authors", "authors must contain at least one non-empty value");
    }

    const providedSourcePlatform = normalizeOptionalString(dto.sourcePlatform);
    const sourcePlatform = (providedSourcePlatform ?? "manual").toLowerCase();
    const sourceBookId = normalizeOptionalString(dto.sourceBookId);
    const sourceUrl = normalizeOptionalString(dto.sourceUrl);

    if (sourceBookId && !providedSourcePlatform) {
      throw CatalogError.validation("sourcePlatform", "sourcePlatform is required when sourceBookId is provided");
    }

    if (!sourceBookId && providedSourcePlatform && sourcePlatform !== "manual") {
      throw CatalogError.validation("sourceBookId", "sourceBookId is required when sourcePlatform is not manual");
    }

    const authorsText = authors.join(", ");
    const titleNormalized = normalizeTitle(title);
    const publishYear = typeof dto.publishYear === "number" ? dto.publishYear : null;
    const editionTag = normalizeOptionalString(dto.editionTag);

    if (sourceBookId) {
      const existing = this.duplicates.findBySource(userId, sourcePlatform, sourceBookId);
      if (existing) {
        throw CatalogError.conflict(
          "sourceBookId",
          "Book already exists with the same sourcePlatform + sourceBookId",
          existing.id,
        );
      }
    } else {
      const duplicate = this.duplicates.findPotentialDuplicate(
        userId,
        titleNormalized,
        authorsText,
        publishYear,
        editionTag,
      );

      if (duplicate) {
        throw CatalogError.conflict(
          "title",
          "Book already exists with the same normalized identity",
          duplicate.id,
        );
      }
    }

    const book = Book.create({
      ownerId: userId,
      metadata: {
        title,
        authors,
        isbn: dto.isbn,
        language: dto.language,
        coverUrl: dto.coverUrl,
        description: dto.description,
        publisher: dto.publisher,
        publishYear,
        editionTag,
      },
      sourceReference: sourceBookId || sourceUrl || sourcePlatform !== "manual"
        ? {
            platform: sourcePlatform,
            sourceBookId,
            sourceUrl,
            hash: dto.hash,
            format: dto.format,
          }
        : undefined,
    });

    try {
      const bookId = this.books.insert(book);
      const created = this.views.getBook(userId, bookId);
      if (!created) throw new Error("Failed to load created book");
      return created;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (sourceBookId && this.isSourceIdentityConstraint(message)) {
        const existing = this.duplicates.findBySource(userId, sourcePlatform, sourceBookId);
        if (existing) {
          throw CatalogError.conflict(
            "sourceBookId",
            "Book already exists with the same sourcePlatform + sourceBookId",
            existing.id,
          );
        }
      }
      throw error;
    }
  }

  private isSourceIdentityConstraint(message: string): boolean {
    return message.includes("uq_source_refs_user_platform_bookid")
      || (
        message.includes("source_refs.user_id")
        && message.includes("source_refs.source_platform")
        && message.includes("source_refs.source_book_id")
      );
  }
}
