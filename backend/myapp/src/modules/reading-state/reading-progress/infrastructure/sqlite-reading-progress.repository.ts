import { Injectable } from "@nestjs/common";
import { SqliteService } from "../../../../platform/persistence/sqlite/sqlite.service";
import type { ReadingProgressRepositoryPort } from "../application/ports/reading-progress-repository.port";
import { ReadingProgress, UpsertProgressInput } from "../domain/reading-progress.types";

interface ReadingProgressRow {
  id: number;
  user_id: number;
  book_id: number;
  book_hash: string;
  location: string;
  location_type: string;
  fraction: number;
  device_id: string;
  device_sequence: number;
  revision: number;
  created_at: number;
  updated_at: number;
}

@Injectable()
export class SqliteReadingProgressRepository implements ReadingProgressRepositoryPort {
  constructor(private readonly sqliteService: SqliteService) {}

  /** 每本书保留一个权威位置；同设备只接受严格递增的 sequence。 */
  upsert(input: UpsertProgressInput & { now: number }): { progress: ReadingProgress; changed: boolean } {
    const db = this.sqliteService.getDatabase();
    const ownsTransaction = !db.isTransaction;
    if (ownsTransaction) db.exec("BEGIN IMMEDIATE TRANSACTION");
    try {
      const device = db.prepare(`
        SELECT last_sequence FROM reading_progress_devices
        WHERE user_id = ? AND book_id = ? AND device_id = ?
      `).get(input.userId, input.bookId, input.deviceId) as { last_sequence: number } | undefined;
      if (device && input.deviceSequence <= device.last_sequence) {
        const current = this.findByUserBook(input.userId, input.bookId);
        if (!current) throw new Error("Progress device sequence exists without progress row");
        if (ownsTransaction) db.exec("COMMIT");
        return { progress: current, changed: false };
      }

      db.prepare(`
        INSERT INTO reading_progress_devices (user_id, book_id, device_id, last_sequence, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, book_id, device_id) DO UPDATE SET
          last_sequence = excluded.last_sequence,
          updated_at = excluded.updated_at
      `).run(input.userId, input.bookId, input.deviceId, input.deviceSequence, input.now);

      db.prepare(`
        INSERT INTO reading_progress (
          user_id, book_id, book_hash, location, location_type, fraction, device_id,
          device_sequence, revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(user_id, book_id) DO UPDATE SET
          book_hash = excluded.book_hash,
          location = excluded.location,
          location_type = excluded.location_type,
          fraction = excluded.fraction,
          device_id = excluded.device_id,
          device_sequence = excluded.device_sequence,
          revision = reading_progress.revision + 1,
          updated_at = excluded.updated_at
      `).run(
        input.userId, input.bookId, input.bookHash, input.location, input.locationType,
        input.fraction, input.deviceId, input.deviceSequence, input.now, input.now,
      );
      const progress = this.findByUserBook(input.userId, input.bookId)!;
      if (ownsTransaction) db.exec("COMMIT");
      return { progress, changed: true };
    } catch (error) {
      if (ownsTransaction && db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }

  findByUserBook(userId: number, bookId: number): ReadingProgress | null {
    const db = this.sqliteService.getDatabase();
    const row = db
      .prepare("SELECT * FROM reading_progress WHERE user_id = ? AND book_id = ?")
      .get(userId, bookId) as unknown as ReadingProgressRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  private mapRow(row: ReadingProgressRow): ReadingProgress {
    return {
      id: row.id,
      userId: row.user_id,
      bookId: row.book_id,
      bookHash: row.book_hash,
      location: row.location,
      locationType: row.location_type as ReadingProgress["locationType"],
      fraction: row.fraction,
      deviceId: row.device_id,
      deviceSequence: row.device_sequence,
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
