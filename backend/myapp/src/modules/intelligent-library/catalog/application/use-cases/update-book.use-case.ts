import { CatalogError } from "../../domain/catalog.error";
import type { LibraryBookView } from "../query-model/library-book.view";
import { normalizeOptionalString } from "../../domain/library.utils";
import type { UpdateBookCommand } from "../catalog.commands";
import type { BookRepositoryPort } from "../ports/book-repository.port";
import type { CatalogBookViewQueryPort } from "../ports/catalog-book-view-query.port";

const MAX_SAVE_ATTEMPTS = 3;

export class UpdateBookUseCase {
  constructor(
    private readonly books: BookRepositoryPort,
    private readonly views: CatalogBookViewQueryPort,
  ) {}

  execute(userId: number, bookId: number, dto: UpdateBookCommand): LibraryBookView {
    let book = this.books.findById(userId, bookId);
    if (!book) throw CatalogError.notFound("book", "Book not found");

    // COMPATIBILITY: isbn is accepted by the DTO but historically does not count as a standalone edit.
    const hasAnyField =
      dto.title !== undefined ||
      dto.authors !== undefined ||
      dto.language !== undefined ||
      dto.coverUrl !== undefined ||
      dto.description !== undefined ||
      dto.publishYear !== undefined ||
      dto.publisher !== undefined ||
      dto.editionTag !== undefined;

    if (!hasAnyField) {
      throw CatalogError.validation(null, "At least one editable field is required");
    }

    if (dto.title !== undefined && !normalizeOptionalString(dto.title)) {
      throw CatalogError.validation("title", "title is required");
    }

    for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt += 1) {
      const expectedVersion = book.version;
      book.editMetadata(dto);
      const result = this.books.save(book, expectedVersion);
      if (result === "saved") {
        const view = this.views.getBook(userId, bookId);
        if (!view) throw CatalogError.internal();
        return view;
      }
      if (result === "not_found") throw CatalogError.notFound("book", "Book not found");
      book = this.books.findById(userId, bookId);
      if (!book) throw CatalogError.notFound("book", "Book not found");
    }
    throw CatalogError.internal();
  }
}
