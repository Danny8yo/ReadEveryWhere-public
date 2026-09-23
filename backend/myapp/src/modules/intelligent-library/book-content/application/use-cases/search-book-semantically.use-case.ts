import type { BookContentSourcePort } from "../ports/book-content-source.port";
import { ReaderToolException } from "../../domain/reader-tool-error";
import { requireOwnedBook } from "../reader-tool.utils";

export class SearchBookSemanticallyUseCase {
  constructor(private readonly source: BookContentSourcePort) {}

  execute(userId: number, bookId: number): never {
    const book = this.source.findOwnedBook(userId, bookId);
    requireOwnedBook(book);
    throw new ReaderToolException(
      "INDEX_NOT_CONFIGURED",
      "Semantic indexing is not configured. Use book_toc or book_search_text for this book.",
      "bookId",
    );
  }
}
