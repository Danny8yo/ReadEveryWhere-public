import { CatalogError } from "../domain/catalog.error";
import type { LibraryBookView } from "./query-model/library-book.view";
import type {
  ApplyBookMetadataCommand,
  ApplyBookMetadataPort,
} from "./ports/apply-book-metadata.port";
import type { BookRepositoryPort } from "./ports/book-repository.port";
import type { CatalogBookViewQueryPort } from "./ports/catalog-book-view-query.port";

export class ApplyBookMetadataService implements ApplyBookMetadataPort {
  constructor(
    private readonly books: BookRepositoryPort,
    private readonly views: CatalogBookViewQueryPort,
  ) {}

  apply(userId: number, bookId: number, command: Readonly<ApplyBookMetadataCommand>): LibraryBookView {
    const book = this.books.findById(userId, bookId);
    if (!book) throw CatalogError.notFound("book", "Book not found");
    if (book.version !== command.expectedVersion) {
      throw CatalogError.conflict("version", "Book changed while applying metadata; refresh candidates and retry");
    }
    if (command.title !== undefined && !command.title.trim()) {
      throw CatalogError.validation("title", "title is required");
    }
    const expectedVersion = book.version;
    // Accepted source fields intentionally do not modify SourceReference.
    const changed = book.editMetadata({
      title: command.title,
      authors: command.authors,
      isbn: command.isbn,
      language: command.language,
      coverUrl: command.coverUrl,
      description: command.description,
      publishYear: command.publishYear,
      publisher: command.publisher,
      editionTag: command.editionTag,
    });
    if (!changed) {
      const view = this.views.getBook(userId, bookId);
      if (!view) throw CatalogError.internal();
      return view;
    }
    const result = this.books.save(book, expectedVersion);
    if (result === "not_found") throw CatalogError.notFound("book", "Book not found");
    if (result === "conflict") {
      throw CatalogError.conflict("version", "Book changed while applying metadata; refresh candidates and retry");
    }
    const view = this.views.getBook(userId, bookId);
    if (!view) throw CatalogError.internal();
    return view;
  }
}
