import { CatalogError } from "../../domain/catalog.error";
import type { BookReadingProfileJSON } from "../../domain/book-reading-profile";
import type { BookRepositoryPort } from "../ports/book-repository.port";

const MAX_SAVE_ATTEMPTS = 3;

export class ClearBookReadingProfileUseCase {
  constructor(private readonly books: BookRepositoryPort) {}

  execute(userId: number, bookId: number): BookReadingProfileJSON {
    let book = this.books.findById(userId, bookId);
    if (!book) throw CatalogError.notFound("bookId", "Book not found");
    for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt += 1) {
      const expectedVersion = book.version;
      if (!book.clearReadingProfile("manual")) return book.readingProfile;
      if (this.books.save(book, expectedVersion) === "saved") return book.readingProfile;
      const current = this.books.findById(userId, bookId);
      if (!current) throw CatalogError.notFound("bookId", "Book not found");
      book = current;
    }
    throw CatalogError.conflict("version", "Book changed while the reading profile was being cleared");
  }
}
