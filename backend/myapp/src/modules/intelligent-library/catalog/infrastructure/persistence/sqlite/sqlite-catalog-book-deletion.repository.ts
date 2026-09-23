import { LIBRARY_PROJECTION_CHANGE_PORT, type LibraryProjectionChangePort } from "../../../../public/library-projection-change.port";
import { afterCommit, transact } from "../../../../../../platform/persistence/sqlite/transaction";
import { Inject, Injectable } from "@nestjs/common";
import { DatabaseSync } from "node:sqlite";
import { SqliteService } from "../../../../../../platform/persistence/sqlite/sqlite.service";
import { withSqliteRetry } from "../../../../../../platform/persistence/sqlite/sqlite-retry";
import type { CatalogBookDeletionPort } from "../../../application/ports/catalog-book-deletion.port";

@Injectable()
export class SqliteCatalogBookDeletionRepository implements CatalogBookDeletionPort {
  constructor(private readonly sqlite: SqliteService, @Inject(LIBRARY_PROJECTION_CHANGE_PORT) private readonly changes: LibraryProjectionChangePort) {}

  deleteOne(ownerId: number, bookId: number, cleanupAfter: string, now: string): boolean {
    return this.deleteMany(ownerId, [bookId], cleanupAfter, now).length === 1;
  }

  deleteMany(ownerId: number, bookIds: number[], cleanupAfter: string, now: string): number[] {
    if (bookIds.length === 0) return [];
    const database = this.sqlite.getDatabase();
    const placeholders = bookIds.map(() => "?").join(", ");
    let ownedIds: number[] = [];
    this.transaction(database, () => {
      const rows = database.prepare(`
        SELECT id FROM books
        WHERE user_id = ? AND id IN (${placeholders})
      `).all(ownerId, ...bookIds) as unknown as Array<{ id: number }>;
      ownedIds = rows.map((row) => row.id);
      if (ownedIds.length === 0) return;
      const ownedPlaceholders = ownedIds.map(() => "?").join(", ");
      const currentArtifacts = database.prepare(`
        SELECT current.artifact_id
        FROM book_current_artifacts current
        WHERE current.book_id IN (${ownedPlaceholders})
      `).all(...ownedIds) as unknown as Array<{ artifact_id: string }>;
      database.prepare(`
        DELETE FROM book_current_artifacts
        WHERE book_id IN (${ownedPlaceholders})
      `).run(...ownedIds);
      if (currentArtifacts.length > 0) {
        const artifactPlaceholders = currentArtifacts.map(() => "?").join(", ");
        database.prepare(`
        UPDATE book_artifacts
        SET status = 'retired', cleanup_after = ?, updated_at = ?
        WHERE status = 'active' AND artifact_id IN (${artifactPlaceholders})
        `).run(cleanupAfter, now, ...currentArtifacts.map((row) => row.artifact_id));
      }
      database.prepare(`
        DELETE FROM books
        WHERE user_id = ? AND id IN (${ownedPlaceholders})
      `).run(ownerId, ...ownedIds);
      afterCommit(database, () => this.changes.changed(ownerId));
    });
    return ownedIds;
  }

  private transaction(database: DatabaseSync, callback: () => void): void {
    withSqliteRetry(() => transact(database, callback));
  }

}
