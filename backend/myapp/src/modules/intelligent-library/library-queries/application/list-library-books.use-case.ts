import type { BookAnalysisSummaryQueryPort } from "../../book-analysis/application/ports/book-analysis-summary-query.port";
import type { LibraryBookViewPage } from "../../catalog/application/query-model/library-book.view";
import type { LibraryReadModelQueryPort } from "./ports/library-read-model-query.port";
import type { EbookFormat } from "../../public/ebook-format";

export class ListLibraryBooksUseCase {
  constructor(
    private readonly libraryRepository: LibraryReadModelQueryPort,
    private readonly analyses: BookAnalysisSummaryQueryPort,
  ) {}

  execute(userId: number, dto: {
    page: number;
    pageSize: number;
    keyword?: string;
    primaryGenre?: string;
    secondaryGenre?: string;
    formats?: EbookFormat[];
  }): LibraryBookViewPage {
    const result = this.libraryRepository.listBooks({
      userId,
      page: dto.page,
      pageSize: dto.pageSize,
      keyword: dto.keyword,
      primaryGenre: dto.primaryGenre,
      secondaryGenre: dto.secondaryGenre,
      formats: dto.formats,
    });
    return {
      ...result,
      items: result.items.map((book) => ({
        ...book,
        bookAnalysis: this.analyses.project(book),
      })),
    };
  }
}
