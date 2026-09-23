import { LIBRARY_PROJECTION_CHANGE_PORT, type LibraryProjectionChangePort } from "../../public/library-projection-change.port";
import { afterCommit, transact } from "../../../../platform/persistence/sqlite/transaction";
import { Inject, Injectable } from "@nestjs/common";
import { SqliteService } from "../../../../platform/persistence/sqlite/sqlite.service";
import type {
  BookDoubanRating,
  BookDoubanRatingRepository,
} from "../application/ports/book-douban-rating.repository";

@Injectable()
export class SqliteBookDoubanRatingRepository implements BookDoubanRatingRepository {
  constructor(private readonly sqlite: SqliteService, @Inject(LIBRARY_PROJECTION_CHANGE_PORT) private readonly changes: LibraryProjectionChangePort) {}

  upsert(bookId: number, rating: Readonly<BookDoubanRating>): BookDoubanRating {
    this.sqlite.getDatabase().prepare(`
      INSERT INTO book_douban_ratings (
        book_id, source_book_id, source_url, source_title,
        rating, rating_count, fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(book_id) DO UPDATE SET
        source_book_id = excluded.source_book_id,
        source_url = excluded.source_url,
        source_title = excluded.source_title,
        rating = excluded.rating,
        rating_count = excluded.rating_count,
        fetched_at = excluded.fetched_at
      `).run(
      bookId,
      rating.sourceBookId,
      rating.sourceUrl,
      rating.sourceTitle,
      rating.rating,
      rating.ratingCount,
      rating.fetchedAt,
    );
    const owner = this.sqlite.getDatabase().prepare("SELECT user_id FROM books WHERE id=?").get(bookId);
    if (!owner) throw new Error(`Missing book ${bookId} after rating update`);
    afterCommit(this.sqlite.getDatabase(), () => this.changes.changed(Number(owner.user_id)));
    return { ...rating };
  }
}
