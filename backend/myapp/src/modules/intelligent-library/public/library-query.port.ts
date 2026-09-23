export interface LibraryQueryBookProjection {
  id: number;
  title: string;
  authors: readonly string[];
  isbn: string | null;
  description: string | null;
  publisher: string | null;
  publishYear: number | null;
  updatedAt: string;
  fileName: string | null;
  mimeType: string | null;
  isDownloaded: boolean;
}

export interface LibraryQueryPage {
  items: readonly LibraryQueryBookProjection[];
  total: number;
  page: number;
  pageSize: number;
}

export interface LibraryQueryPort {
  getOwnedBook(query: Readonly<{ userId: number; bookId: number }>): LibraryQueryBookProjection | null;
  listBooks(query: Readonly<{
    userId: number;
    page: number;
    pageSize: number;
    keyword?: string;
  }>): LibraryQueryPage;
}

export const LIBRARY_QUERY_PORT = Symbol(
  "INTELLIGENT_LIBRARY_LIBRARY_QUERY_PORT",
);
