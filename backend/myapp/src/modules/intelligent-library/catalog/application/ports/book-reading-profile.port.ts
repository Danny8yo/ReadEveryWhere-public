import type { BookReadingGenre, BookReadingProfileJSON } from "../../domain/book-reading-profile";

export interface EditBookReadingProfileCommand {
  primaryGenre?: BookReadingGenre | null;
  secondaryGenres?: BookReadingGenre[];
  classificationSummary?: string | null;
}

export interface BookReadingProfilePort {
  get(userId: number, bookId: number): BookReadingProfileJSON;
  edit(userId: number, bookId: number, command: Readonly<EditBookReadingProfileCommand>): BookReadingProfileJSON;
  clear(userId: number, bookId: number): BookReadingProfileJSON;
}

export const BOOK_READING_PROFILE_PORT = Symbol("INTELLIGENT_LIBRARY_BOOK_READING_PROFILE_PORT");
