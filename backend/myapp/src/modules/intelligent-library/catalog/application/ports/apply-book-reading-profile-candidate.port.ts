import type {
  BookContentRevision,
  BookProfileCandidate,
} from "../../domain/book";
import type { BookReadingProfileJSON } from "../../domain/book-reading-profile";

export interface ApplyBookReadingProfileCandidatePort {
  apply(
    userId: number,
    bookId: number,
    candidate: Readonly<BookProfileCandidate>,
    currentRevision: Readonly<BookContentRevision>,
    override: boolean,
  ): BookReadingProfileJSON;
}

export const APPLY_BOOK_READING_PROFILE_CANDIDATE_PORT = Symbol(
  "INTELLIGENT_LIBRARY_APPLY_BOOK_READING_PROFILE_CANDIDATE_PORT",
);
