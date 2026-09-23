export interface BookFileStreamingQuery {
  userId: number;
  bookId: number;
}

export interface BookFileStreamingProjection {
  absolutePath: string | null;
  mimeType: string | null;
  downloadStatus: string | null;
}

export interface BookFileStreamingQueryPort {
  findForStreaming(
    query: Readonly<BookFileStreamingQuery>,
  ): BookFileStreamingProjection | null;
}

export const BOOK_FILE_STREAMING_QUERY_PORT = Symbol(
  "INTELLIGENT_LIBRARY_BOOK_FILE_STREAMING_QUERY_PORT",
);
