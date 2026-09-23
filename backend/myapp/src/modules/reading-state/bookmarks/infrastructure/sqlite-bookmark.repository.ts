import { Injectable } from "@nestjs/common";
import { SqliteService } from "../../../../platform/persistence/sqlite/sqlite.service";
import type { BookmarkRepositoryPort } from "../application/ports/bookmark-repository.port";
import { Bookmark, CreateBookmarkInput } from "../domain/bookmark.types";

interface BookmarkRow {
  id: number;
  user_id: number;
  book_id: number;
  book_hash: string;
  location: string;
  location_type: string;
  fraction: number;
  chapter_label: string | null;
  created_at: number;
}

@Injectable()
export class SqliteBookmarkRepository implements BookmarkRepositoryPort {
  constructor(private readonly sqliteService: SqliteService) {}

  create(input: CreateBookmarkInput & { now: number }): { bookmark: Bookmark; created: boolean } {
    const db = this.sqliteService.getDatabase();
    const result = db
      .prepare(`
        INSERT INTO bookmarks (
          user_id, book_id, book_hash, location, location_type, fraction, chapter_label, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, book_id, location) DO NOTHING
      `)
      .run(
        input.userId,
        input.bookId,
        input.bookHash,
        input.location,
        input.locationType,
        input.fraction,
        input.chapterLabel,
        input.now,
      );
    if (result.changes > 0) {
      return { bookmark: this.findById(Number(result.lastInsertRowid))!, created: true };
    }
    const existing = db.prepare(`
      SELECT * FROM bookmarks WHERE user_id = ? AND book_id = ? AND location = ?
    `).get(input.userId, input.bookId, input.location) as unknown as BookmarkRow | undefined;
    if (!existing) throw new Error("Bookmark conflict did not return the existing row");
    return { bookmark: this.mapRow(existing), created: false };
  }

  findById(id: number): Bookmark | null {
    const db = this.sqliteService.getDatabase();
    const row = db
      .prepare("SELECT * FROM bookmarks WHERE id = ?")
      .get(id) as unknown as BookmarkRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  listByUserBook(userId: number, bookId: number): Bookmark[] {
    const db = this.sqliteService.getDatabase();
    const rows = db
      .prepare(
        "SELECT * FROM bookmarks WHERE user_id = ? AND book_id = ? ORDER BY created_at ASC, id ASC",
      )
      .all(userId, bookId) as unknown as BookmarkRow[];
    return rows.map((row) => this.mapRow(row));
  }

  deleteByIdAndUser(id: number, userId: number): Bookmark | null {
    const db = this.sqliteService.getDatabase();
    const existing = this.findById(id);
    if (!existing || existing.userId !== userId) return null;
    const result = db
      .prepare("DELETE FROM bookmarks WHERE id = ? AND user_id = ?")
      .run(id, userId);
    return result.changes > 0 ? existing : null;
  }

  private mapRow(row: BookmarkRow): Bookmark {
    return {
      id: row.id,
      userId: row.user_id,
      bookId: row.book_id,
      bookHash: row.book_hash,
      location: row.location,
      locationType: row.location_type as Bookmark["locationType"],
      fraction: row.fraction,
      chapterLabel: row.chapter_label,
      createdAt: row.created_at,
    };
  }
}
