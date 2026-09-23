import { LIBRARY_PROJECTION_CHANGE_PORT, type LibraryProjectionChangePort } from "../../../../public/library-projection-change.port";
import { afterCommit, transact } from "../../../../../../platform/persistence/sqlite/transaction";
import { Inject, Injectable } from "@nestjs/common";
import { DatabaseSync } from "node:sqlite";
import { SqliteService } from "../../../../../../platform/persistence/sqlite/sqlite.service";
import { withSqliteRetry } from "../../../../../../platform/persistence/sqlite/sqlite-retry";
import type { BookArtifactRepositoryPort } from "../../../application/ports/book-artifact-repository.port";
import { BookArtifact, BookArtifactValues } from "../../../domain/book-artifact";
import { SqliteBookRepository } from "./sqlite-book.repository";

@Injectable()
export class SqliteBookArtifactRepository implements BookArtifactRepositoryPort {
  constructor(
    private readonly sqlite: SqliteService,
    private readonly books: SqliteBookRepository,
    @Inject(LIBRARY_PROJECTION_CHANGE_PORT) private readonly changes: LibraryProjectionChangePort,
  ) {}

  reserve(artifact: BookArtifact): void {
    const value = artifact.snapshot;
    if (value.status !== "reserved") throw new Error("Only reserved artifacts can be inserted");
    this.sqlite.getDatabase().prepare(`
      INSERT INTO book_artifacts (
        artifact_id, delivery_id, user_id, book_id, status, stored_path,
        staging_stored_path, source_platform, source_url, managed, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'reserved', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.artifactId,
      value.deliveryId,
      value.ownerId,
      value.bookId,
      value.storedPath,
      value.stagingStoredPath,
      value.sourcePlatform,
      value.sourceUrl,
      value.managed ? 1 : 0,
      value.createdAt,
      value.updatedAt,
    );
  }

  activate(artifact: BookArtifact, retiredCleanupAfter: string): void {
    const value = artifact.snapshot;
    if (value.status !== "active" || !value.fileName || !value.mimeType || value.fileSize === null || !value.checksum) {
      throw new Error("Only complete active artifacts can be persisted");
    }
    const database = this.sqlite.getDatabase();
    this.transaction(database, () => {
      const current = database.prepare(`
        SELECT current.artifact_id, artifact.checksum
        FROM book_current_artifacts current
        INNER JOIN book_artifacts artifact ON artifact.artifact_id = current.artifact_id
        WHERE artifact.user_id = ? AND current.book_id = ?
        LIMIT 1
      `).get(value.ownerId, value.bookId) as unknown as {
        artifact_id: string | null;
        checksum: string | null;
      } | undefined;
      const ready = database.prepare(`
        UPDATE book_artifacts
        SET status = 'ready', file_name = ?, mime_type = ?, file_size = ?, checksum = ?, updated_at = ?
        WHERE artifact_id = ? AND delivery_id = ? AND user_id = ? AND book_id = ? AND status = 'reserved'
      `).run(
        value.fileName,
        value.mimeType,
        value.fileSize,
        value.checksum,
        value.updatedAt,
        value.artifactId,
        value.deliveryId,
        value.ownerId,
        value.bookId,
      );
      if (Number(ready.changes) !== 1) throw new Error("Artifact reservation is not active");
      if (current?.artifact_id && current.artifact_id !== value.artifactId) {
        database.prepare("DELETE FROM book_current_artifacts WHERE book_id = ? AND artifact_id = ?")
          .run(value.bookId, current.artifact_id);
        database.prepare(`
          UPDATE book_artifacts
          SET status = 'retired', cleanup_after = ?, updated_at = ?
          WHERE artifact_id = ? AND status = 'active'
        `).run(retiredCleanupAfter, value.updatedAt, current.artifact_id);
      }

      const activated = database.prepare(`
        UPDATE book_artifacts
        SET status = 'active', updated_at = ?
        WHERE artifact_id = ? AND status = 'ready'
      `).run(value.updatedAt, value.artifactId);
      if (Number(activated.changes) !== 1) throw new Error("Artifact could not be activated");

      database.prepare(`
        INSERT INTO book_current_artifacts (book_id, artifact_id, activated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(book_id) DO UPDATE SET
          artifact_id = excluded.artifact_id,
          activated_at = excluded.activated_at
      `).run(
        value.bookId,
        value.artifactId,
        value.updatedAt,
      );

      afterCommit(database, () => this.changes.changed(value.ownerId));
      const contentReplaced = Boolean(current?.artifact_id)
        && current?.checksum !== value.checksum;
      if (contentReplaced) {
        this.books.clearReadingProfileForFileReplacement(
          value.ownerId,
          value.bookId,
          value.updatedAt,
        );
        database.prepare(`
          UPDATE book_analysis_candidates SET status = 'invalidated', updated_at = ?
          WHERE user_id = ? AND book_id = ? AND status = 'pending'
        `).run(value.updatedAt, value.ownerId, value.bookId);
      }
    });
  }

  findById(artifactId: string): BookArtifact | null {
    return this.findOne("artifact_id = ?", [artifactId]);
  }

  findByDeliveryId(ownerId: number, deliveryId: string): BookArtifact | null {
    return this.findOne("user_id = ? AND delivery_id = ?", [ownerId, deliveryId]);
  }

  findCurrent(ownerId: number, bookId: number): BookArtifact | null {
    const row = this.sqlite.getDatabase().prepare(`
      SELECT ba.*
      FROM book_current_artifacts current
      INNER JOIN book_artifacts ba ON ba.artifact_id = current.artifact_id
      WHERE ba.user_id = ? AND current.book_id = ?
      LIMIT 1
    `).get(ownerId, bookId) as unknown as Record<string, unknown> | undefined;
    return row ? mapArtifact(row) : null;
  }

  abort(artifactId: string, cleanupAfter: string, now: string): void {
    this.sqlite.getDatabase().prepare(`
      UPDATE book_artifacts
      SET status = 'aborted', cleanup_after = ?, updated_at = ?
      WHERE artifact_id = ? AND status IN ('reserved', 'ready')
    `).run(cleanupAfter, now, artifactId);
  }

  retireCurrentExact(identity: Readonly<{
    ownerId: number;
    bookId: number;
    checksum: string;
    storedPath: string;
  }>, cleanupAfter: string, now: string): boolean {
    const database = this.sqlite.getDatabase();
    let retired = false;
    this.transaction(database, () => {
      const row = database.prepare(`
        SELECT current.artifact_id
        FROM book_current_artifacts current
        INNER JOIN book_artifacts artifact ON artifact.artifact_id = current.artifact_id
        WHERE artifact.user_id = ? AND current.book_id = ? AND artifact.checksum = ?
          AND artifact.stored_path = ?
        LIMIT 1
      `).get(
        identity.ownerId,
        identity.bookId,
        identity.checksum,
        identity.storedPath,
      ) as unknown as { artifact_id: string | null } | undefined;
      if (!row?.artifact_id) return;
      database.prepare(`
        DELETE FROM book_current_artifacts
        WHERE book_id = ? AND artifact_id = ?
      `).run(identity.bookId, row.artifact_id);
      database.prepare(`
        UPDATE book_artifacts
        SET status = 'retired', cleanup_after = ?, updated_at = ?
        WHERE artifact_id = ? AND status = 'active'
      `).run(cleanupAfter, now, row.artifact_id);
      retired = true;
      afterCommit(database, () => this.changes.changed(identity.ownerId));
    });
    return retired;
  }

  claimCollectable(input: Readonly<{
    now: string;
    leaseOwner: string;
    leaseToken: string;
    leaseExpiresAt: string;
    limit: number;
  }>): BookArtifact[] {
    const database = this.sqlite.getDatabase();
    let rows: Array<Record<string, unknown>> = [];
    this.transaction(database, () => {
      // 选取和加 lease 必须位于同一写事务中；否则两个 worker 都可能读到
      // 同一批 artifact，随后互相覆盖 lease 并重复执行物理删除。
      rows = database.prepare(`
        SELECT ba.*
        FROM book_artifacts ba
        WHERE ba.status IN ('retired', 'aborted')
          AND ba.cleanup_after IS NOT NULL
          AND ba.cleanup_after <= ?
          AND (ba.next_cleanup_at IS NULL OR ba.next_cleanup_at <= ?)
          AND (ba.cleanup_lease_expires_at IS NULL OR ba.cleanup_lease_expires_at <= ?)
          AND NOT EXISTS (
            SELECT 1 FROM book_current_artifacts current WHERE current.artifact_id = ba.artifact_id
          )
        ORDER BY ba.cleanup_after ASC, ba.created_at ASC
        LIMIT ?
      `).all(input.now, input.now, input.now, input.limit) as unknown as Array<Record<string, unknown>>;
      if (rows.length === 0) return;
      const ids = rows.map((row) => String(row.artifact_id));
      const placeholders = ids.map(() => "?").join(", ");
      database.prepare(`
        UPDATE book_artifacts
        SET cleanup_lease_owner = ?, cleanup_lease_token = ?, cleanup_lease_expires_at = ?,
          cleanup_attempts = cleanup_attempts + 1, updated_at = ?
        WHERE artifact_id IN (${placeholders})
          AND (cleanup_lease_expires_at IS NULL OR cleanup_lease_expires_at <= ?)
      `).run(input.leaseOwner, input.leaseToken, input.leaseExpiresAt, input.now, ...ids, input.now);
    });
    return rows.map(mapArtifact);
  }

  markDeleted(artifactId: string, leaseToken: string, now: string): boolean {
    const result = this.sqlite.getDatabase().prepare(`
      UPDATE book_artifacts
      SET status = 'deleted', deleted_at = ?, updated_at = ?,
        cleanup_lease_owner = NULL, cleanup_lease_token = NULL, cleanup_lease_expires_at = NULL
      WHERE artifact_id = ? AND cleanup_lease_token = ?
        AND status IN ('retired', 'aborted')
        AND NOT EXISTS (
          SELECT 1 FROM book_current_artifacts current
          WHERE current.artifact_id = book_artifacts.artifact_id
        )
    `).run(now, now, artifactId, leaseToken);
    return Number(result.changes) === 1;
  }

  recordCleanupFailure(
    artifactId: string,
    leaseToken: string,
    error: string,
    nextCleanupAt: string,
    now: string,
  ): void {
    this.sqlite.getDatabase().prepare(`
      UPDATE book_artifacts
      SET last_cleanup_error = ?, next_cleanup_at = ?, updated_at = ?,
        cleanup_lease_owner = NULL, cleanup_lease_token = NULL, cleanup_lease_expires_at = NULL
      WHERE artifact_id = ? AND cleanup_lease_token = ?
    `).run(error.slice(0, 500), nextCleanupAt, now, artifactId, leaseToken);
  }

  recoverExpiredReservations(expiredBefore: string, cleanupAfter: string, now: string): number {
    const result = this.sqlite.getDatabase().prepare(`
      UPDATE book_artifacts
      SET status = 'aborted', cleanup_after = ?, updated_at = ?
      WHERE status IN ('reserved', 'ready') AND updated_at <= ?
    `).run(cleanupAfter, now, expiredBefore);
    return Number(result.changes);
  }

  private findOne(where: string, params: Array<string | number | bigint | null>): BookArtifact | null {
    const row = this.sqlite.getDatabase().prepare(
      `SELECT * FROM book_artifacts WHERE ${where} LIMIT 1`,
    ).get(...params) as unknown as Record<string, unknown> | undefined;
    return row ? mapArtifact(row) : null;
  }

  private transaction(database: DatabaseSync, callback: () => void): void {
    withSqliteRetry(() => transact(database, callback));
  }

}

function mapArtifact(row: Record<string, unknown>): BookArtifact {
  return BookArtifact.rehydrate({
    artifactId: String(row.artifact_id),
    deliveryId: String(row.delivery_id),
    ownerId: Number(row.user_id),
    bookId: Number(row.book_id),
    status: String(row.status) as BookArtifactValues["status"],
    storedPath: String(row.stored_path),
    stagingStoredPath: row.staging_stored_path === null ? null : String(row.staging_stored_path),
    fileName: row.file_name === null ? null : String(row.file_name),
    mimeType: row.mime_type === null ? null : String(row.mime_type),
    fileSize: row.file_size === null ? null : Number(row.file_size),
    checksum: row.checksum === null ? null : String(row.checksum),
    sourcePlatform: row.source_platform === null ? null : String(row.source_platform),
    sourceUrl: row.source_url === null ? null : String(row.source_url),
    managed: Number(row.managed) === 1,
    cleanupAfter: row.cleanup_after === null ? null : String(row.cleanup_after),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deletedAt: row.deleted_at === null ? null : String(row.deleted_at),
  });
}
