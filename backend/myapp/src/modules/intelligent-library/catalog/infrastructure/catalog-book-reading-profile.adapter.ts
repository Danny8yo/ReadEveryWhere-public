import { Injectable } from "@nestjs/common";
import { AppException } from "../../../../platform/http/app-exception";
import type {
  BookReadingProfileAccessResult,
} from "../../public/book-reading-profile-access.port";
import type { CatalogBookViewQueryPort } from "../application/ports/catalog-book-view-query.port";

@Injectable()
export class CatalogBookReadingProfileAdapter {
  constructor(private readonly books: Pick<CatalogBookViewQueryPort, "getBook">) {}

  getCurrentProfile(
    userId: number,
    bookId: number,
  ): Pick<BookReadingProfileAccessResult, "status" | "profile"> {
    const book = this.books.getBook(userId, bookId);
    if (!book) {
      throw new AppException(404, 40401, "Book not found", {
        field: "bookId",
        reason: "BOOK_NOT_FOUND",
      });
    }
    const profile = book.readingProfile;
    if (!profile) {
      throw new Error("BOOK_READING_PROFILE_MISSING");
    }
    if (profile.primaryGenre === null || profile.confidence === null) {
      return { status: "not_analyzed", profile: null };
    }
    const confidence = profile.confidence.kind === "user-determined"
      ? { kind: "user-determined" as const }
      : profile.confidence.kind === "ai-score"
        && profile.confidence.score !== null
        && Number.isFinite(profile.confidence.score)
        ? { kind: "ai-score" as const, score: profile.confidence.score }
        : null;
    if (!confidence) throw new Error("BOOK_READING_PROFILE_CONFIDENCE_INVALID");
    return {
      status: "ready",
      profile: {
        profileId: profile.id,
        primaryGenre: profile.primaryGenre,
        secondaryGenres: [...profile.secondaryGenres],
        traits: [...profile.traits],
        confidence,
        classificationSummary: profile.classificationSummary,
        profileVersion: profile.profileVersion,
        updatedAt: profile.updatedAt,
      },
    };
  }
}
