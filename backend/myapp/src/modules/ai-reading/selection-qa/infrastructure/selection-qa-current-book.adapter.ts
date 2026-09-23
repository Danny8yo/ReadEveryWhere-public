import type { LibraryQueryPort } from "../../../intelligent-library/public/library-query.port";
import type { QaCurrentBook, QaCurrentBookPort } from "../application/selection-qa-runtime.port";
import { SelectionQaError } from "../application/selection-qa.types";

export class SelectionQaCurrentBookAdapter implements QaCurrentBookPort {
  constructor(private readonly library: LibraryQueryPort) {}

  get(userId: number, bookId: number): QaCurrentBook {
    const book = this.library.getOwnedBook({ userId, bookId });
    if (!book || book.id !== bookId || !book.title.trim()) {
      throw new SelectionQaError("CURRENT_BOOK_UNAVAILABLE");
    }
    return { bookId: book.id, title: book.title };
  }
}
