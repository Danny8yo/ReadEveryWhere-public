import type {
  LibraryQueryBookProjection,
  LibraryQueryPage,
  LibraryQueryPort,
} from "../../public/library-query.port";
import type { LibraryBookView } from "../../catalog/application/query-model/library-book.view";
import type { LibraryReadModelQueryPort } from "./ports/library-read-model-query.port";

export class LibraryQueryService implements LibraryQueryPort {
  constructor(private readonly library: LibraryReadModelQueryPort) {}

  getOwnedBook(query: Readonly<{ userId: number; bookId: number }>): LibraryQueryBookProjection | null {
    const book = this.library.getBook(query.userId, query.bookId);
    return book ? this.project(book) : null;
  }

  listBooks(query: Readonly<{
    userId: number;
    page: number;
    pageSize: number;
    keyword?: string;
  }>): LibraryQueryPage {
    const result = this.library.listBooks(query);
    return { ...result, items: result.items.map((book) => this.project(book)) };
  }

  private project(book: LibraryBookView): LibraryQueryBookProjection {
    return {
      id: book.id,
      title: book.title,
      authors: [...book.authors],
      isbn: book.isbn,
      description: book.description,
      publisher: book.publisher,
      publishYear: book.publishYear,
      updatedAt: book.updatedAt,
      fileName: book.fileName,
      mimeType: book.mimeType,
      isDownloaded: book.isDownloaded,
    };
  }
}
