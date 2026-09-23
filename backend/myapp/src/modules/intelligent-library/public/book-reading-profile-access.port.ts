export type BookReadingProfileAccessConfidence =
  | { kind: "ai-score"; score: number }
  | { kind: "user-determined" };

export interface CurrentBookReadingProfileProjection {
  profileId: string;
  primaryGenre: string;
  secondaryGenres: string[];
  traits: string[];
  confidence: BookReadingProfileAccessConfidence;
  classificationSummary: string | null;
  profileVersion: number;
  updatedAt: string;
}

export interface BookReadingProfileAccessResult {
  status:
    | "not_analyzed"
    | "pending"
    | "running"
    | "ready"
    | "failed"
    | "stale"
    | "unsupported";
  stale: boolean;
  profile: CurrentBookReadingProfileProjection | null;
  errorCode: string | null;
}

export interface BookReadingProfileAccessPort {
  getCurrentProfile(userId: number, bookId: number): Promise<BookReadingProfileAccessResult>;
}

export const BOOK_READING_PROFILE_ACCESS_PORT = Symbol(
  "INTELLIGENT_LIBRARY_BOOK_READING_PROFILE_ACCESS_PORT",
);
