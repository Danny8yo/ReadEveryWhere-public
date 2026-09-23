import { Injectable } from "@nestjs/common";
import { SqliteService } from "../../../platform/persistence/sqlite/sqlite.service";
import type { ReadingStateVersionPort } from "../application/ports/reading-state-version.port";

@Injectable()
export class SqliteReadingStateVersionRepository implements ReadingStateVersionPort {
  constructor(private readonly sqlite: SqliteService) {}

  getRevision(userId: number, bookId: number): number {
    const row = this.sqlite.getDatabase().prepare(`
      SELECT revision FROM reading_state_versions WHERE user_id = ? AND book_id = ?
    `).get(userId, bookId) as { revision: number } | undefined;
    return row?.revision ?? 0;
  }

  bumpRevision(userId: number, bookId: number, now: number): number {
    const row = this.sqlite.getDatabase().prepare(`
      INSERT INTO reading_state_versions (user_id, book_id, revision, updated_at)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(user_id, book_id) DO UPDATE SET
        revision = reading_state_versions.revision + 1,
        updated_at = excluded.updated_at
      RETURNING revision
    `).get(userId, bookId, now) as { revision: number };
    return row.revision;
  }
}
