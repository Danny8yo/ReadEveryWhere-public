import type {
  ApplyBookReadingProfileCandidatePort,
} from "../ports/apply-book-reading-profile-candidate.port";
import type {
  BookContentRevision,
  BookProfileCandidate,
} from "../../domain/book";
import type { BookReadingProfileJSON } from "../../domain/book-reading-profile";
import { CatalogError } from "../../domain/catalog.error";
import type { BookRepositoryPort } from "../ports/book-repository.port";

export class ApplyBookReadingProfileCandidateUseCase implements ApplyBookReadingProfileCandidatePort {
  constructor(private readonly books: BookRepositoryPort) {}

  apply(
    userId: number,
    bookId: number,
    candidate: Readonly<BookProfileCandidate>,
    currentRevision: Readonly<BookContentRevision>,
    override: boolean,
  ): BookReadingProfileJSON {
    const book = this.books.findById(userId, bookId);
    if (!book) throw CatalogError.notFound("bookId", "Book not found");
    const expectedVersion = book.version;
    const changed = book.applyAnalysisCandidate(
      candidate,
      currentRevision,
      override,
    );
    if (!changed) return book.readingProfile;
    const saved = this.books.save(book, expectedVersion);
    if (saved === "saved") return book.readingProfile;
    if (saved === "not_found") throw CatalogError.notFound("bookId", "Book not found");
    throw CatalogError.conflict("version", "Book changed while applying the analysis candidate");
  }
}
