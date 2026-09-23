import type { DoubanRatingCandidate } from "../../public/metadata-source.port";
import type { CatalogBookViewQueryPort } from "../../catalog/application/ports/catalog-book-view-query.port";
import { CatalogError } from "../../catalog/domain/catalog.error";
import type {
  BookDoubanRating,
  BookDoubanRatingRepository,
} from "./ports/book-douban-rating.repository";

export class SaveDoubanRatingUseCase {
  constructor(
    private readonly books: CatalogBookViewQueryPort,
    private readonly ratings: BookDoubanRatingRepository,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  execute(
    userId: number,
    bookId: number,
    candidate: Readonly<DoubanRatingCandidate>,
  ): BookDoubanRating {
    if (!this.books.getBook(userId, bookId)) {
      throw CatalogError.notFound("bookId", "Book not found");
    }
    if (candidate.sourcePlatform !== "douban") {
      throw CatalogError.validation("sourcePlatform", "sourcePlatform must be douban");
    }
    return this.ratings.upsert(bookId, {
      sourceBookId: candidate.sourceBookId,
      sourceUrl: candidate.sourceUrl,
      sourceTitle: candidate.title,
      rating: candidate.rating,
      ratingCount: candidate.ratingCount,
      fetchedAt: this.now(),
    });
  }
}
