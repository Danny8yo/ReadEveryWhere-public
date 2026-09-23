export interface BookDoubanRating {
  sourceBookId: string;
  sourceUrl: string;
  sourceTitle: string | null;
  rating: number | null;
  ratingCount: number | null;
  fetchedAt: string;
}

export interface BookDoubanRatingRepository {
  upsert(bookId: number, rating: Readonly<BookDoubanRating>): BookDoubanRating;
}

export const BOOK_DOUBAN_RATING_REPOSITORY = Symbol(
  "INTELLIGENT_LIBRARY_BOOK_DOUBAN_RATING_REPOSITORY",
);
