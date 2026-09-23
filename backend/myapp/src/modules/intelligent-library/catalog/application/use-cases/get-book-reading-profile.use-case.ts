import { CatalogError } from "../../domain/catalog.error";
import type { BookReadingProfileJSON } from "../../domain/book-reading-profile";
import type { BookRepositoryPort } from "../ports/book-repository.port";

export class GetBookReadingProfileUseCase {
  constructor(private readonly books: BookRepositoryPort) {}

  execute(userId: number, bookId: number): BookReadingProfileJSON {
    const book = this.books.findById(userId, bookId);
    if (!book) throw CatalogError.notFound("bookId", "Book not found");
    return book.readingProfile;
  }
}
