import { CatalogError } from "../../domain/catalog.error";
import { BookProfileDomainError, type BookReadingProfileJSON } from "../../domain/book-reading-profile";
import type { EditBookReadingProfileCommand } from "../ports/book-reading-profile.port";
import type { BookRepositoryPort } from "../ports/book-repository.port";

const MAX_SAVE_ATTEMPTS = 3;

export class EditBookReadingProfileUseCase {
  constructor(private readonly books: BookRepositoryPort) {}

  execute(userId: number, bookId: number, command: Readonly<EditBookReadingProfileCommand>): BookReadingProfileJSON {
    if (command.primaryGenre === undefined
      && command.secondaryGenres === undefined
      && command.classificationSummary === undefined) {
      throw CatalogError.validation(null, "At least one editable field is required");
    }
    let book = this.books.findById(userId, bookId);
    if (!book) throw CatalogError.notFound("bookId", "Book not found");
    for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt += 1) {
      const expectedVersion = book.version;
      try {
        const changed = book.editReadingProfile(command);
        if (!changed) return book.readingProfile;
      } catch (error) {
        if (error instanceof BookProfileDomainError) {
          throw CatalogError.validation(null, error.message);
        }
        throw error;
      }
      if (this.books.save(book, expectedVersion) === "saved") return book.readingProfile;
      const current = this.books.findById(userId, bookId);
      if (!current) throw CatalogError.notFound("bookId", "Book not found");
      book = current;
    }
    throw CatalogError.conflict("version", "Book changed while the reading profile was being edited");
  }
}
