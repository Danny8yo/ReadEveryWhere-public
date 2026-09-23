import {
  ReaderToolException,
  decodeCursor,
  encodeCursor,
  type LibraryQueryPort,
} from "../../../modules/intelligent-library/public";

interface LibraryCursor {
  tool: "library_search";
  query: string;
  page: number;
  limit: number;
}

export class SearchLibraryUseCase {
  constructor(private readonly libraryQueries: LibraryQueryPort) {}

  execute(userId: number, input: { query?: string; cursor?: string; limit?: number }) {
    const query = input.query?.trim() ?? "";
    const limit = input.limit ?? 20;
    let page = 1;
    if (input.cursor) {
      const state = decodeCursor<LibraryCursor>(input.cursor, (value) =>
        value.tool === "library_search"
        && value.query === query
        && Number.isInteger(value.page)
        && Number(value.page) >= 1
        && value.limit === limit,
      );
      if (!state) throw new ReaderToolException("CURSOR_INVALID", "Library cursor is invalid or belongs to different search parameters", "cursor");
      page = state.page;
    }

    const result = this.libraryQueries.listBooks({ userId, page, pageSize: limit, keyword: query || undefined });
    const hasMore = page * limit < result.total;
    return {
      query: query || null,
      items: result.items.map((book) => ({
        bookId: book.id,
        title: book.title,
        authors: book.authors,
        format: this.formatOf(book.mimeType, book.fileName),
        readable: book.isDownloaded && this.formatOf(book.mimeType, book.fileName) === "epub",
        updatedAt: book.updatedAt,
      })),
      nextCursor: hasMore ? encodeCursor({ tool: "library_search", query, page: page + 1, limit }) : null,
      hasMore,
    };
  }

  private formatOf(mimeType: string | null, fileName: string | null): string | null {
    if (mimeType === "application/epub+zip" || fileName?.toLowerCase().endsWith(".epub")) return "epub";
    if (mimeType === "application/pdf" || fileName?.toLowerCase().endsWith(".pdf")) return "pdf";
    return fileName?.split(".").pop()?.toLowerCase() ?? null;
  }
}
