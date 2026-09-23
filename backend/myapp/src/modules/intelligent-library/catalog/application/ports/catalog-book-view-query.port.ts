import type {
  LibraryBookView,
} from "../query-model/library-book.view";

export interface CatalogBookViewQueryPort {
  getBook(ownerId: number, bookId: number): LibraryBookView | null;
}

export const CATALOG_BOOK_VIEW_QUERY_PORT = Symbol(
  "INTELLIGENT_LIBRARY_CATALOG_BOOK_VIEW_QUERY_PORT",
);
