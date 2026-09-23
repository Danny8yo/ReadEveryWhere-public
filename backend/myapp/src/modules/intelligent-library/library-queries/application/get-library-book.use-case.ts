import type { BookAnalysisSummaryQueryPort } from "../../book-analysis/application/ports/book-analysis-summary-query.port";
import { CatalogError } from "../../catalog/domain/catalog.error";
import type { LibraryReadModelQueryPort } from "./ports/library-read-model-query.port";

export class GetLibraryBookUseCase {
  constructor(
    private readonly library: LibraryReadModelQueryPort,
    private readonly analyses: BookAnalysisSummaryQueryPort,
  ) {}

  execute(userId: number, bookId: number) {
    const book = this.library.getBook(userId, bookId);
    if (!book) throw CatalogError.notFound("bookId", "Book not found");
    return { ...book, bookAnalysis: this.analyses.project(book) };
  }
}
