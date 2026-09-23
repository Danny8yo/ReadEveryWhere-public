import type {
  LibraryBookView,
  LibraryBookViewPage,
  ListBooksInput,
} from "../../../catalog/application/query-model/library-book.view";

export interface LibraryReadModelQueryPort {
  listBooks(input: ListBooksInput): LibraryBookViewPage;
  getBook(userId: number, bookId: number): LibraryBookView | null;
}

export const LIBRARY_READ_MODEL_QUERY_PORT = Symbol(
  "INTELLIGENT_LIBRARY_LIBRARY_READ_MODEL_QUERY_PORT",
);
