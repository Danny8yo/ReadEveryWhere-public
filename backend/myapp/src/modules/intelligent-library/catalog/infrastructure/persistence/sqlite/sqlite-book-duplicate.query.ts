import { Injectable } from "@nestjs/common";
import { SqliteService } from "../../../../../../platform/persistence/sqlite/sqlite.service";
import type {
  BookDuplicateQueryPort,
  DuplicateBookProjection,
} from "../../../application/ports/book-duplicate-query.port";

@Injectable()
export class SqliteBookDuplicateQuery implements BookDuplicateQueryPort {
  constructor(private readonly sqliteService: SqliteService) {}

  findBySource(ownerId: number, platform: string, sourceBookId: string): DuplicateBookProjection | null {
    const row = this.sqliteService.getDatabase().prepare(`
      SELECT b.id, b.title
      FROM source_refs sr
      INNER JOIN books b ON b.id = sr.book_id AND b.user_id = sr.user_id
      WHERE sr.user_id = ? AND sr.source_platform = ? AND sr.source_book_id = ?
      LIMIT 1
    `).get(ownerId, platform, sourceBookId) as unknown as DuplicateBookProjection | undefined;
    return row ?? null;
  }

  findPotentialDuplicate(
    ownerId: number,
    titleNormalized: string,
    authorsText: string,
    publishYear: number | null,
    editionTag: string | null,
  ): DuplicateBookProjection | null {
    const row = this.sqliteService.getDatabase().prepare(`
      SELECT id, title
      FROM books
      WHERE user_id = ?
        AND title_normalized = ?
        AND authors_text = ?
        AND COALESCE(publish_year, -1) = COALESCE(?, -1)
        AND COALESCE(edition_tag, '') = COALESCE(?, '')
      LIMIT 1
    `).get(
      ownerId,
      titleNormalized,
      authorsText,
      publishYear,
      editionTag,
    ) as unknown as DuplicateBookProjection | undefined;
    return row ?? null;
  }

  findByChecksum(ownerId: number, checksum: string): DuplicateBookProjection | null {
    const row = this.sqliteService.getDatabase().prepare(`
      SELECT b.id, b.title
      FROM book_current_artifacts current
      INNER JOIN book_artifacts artifact ON artifact.artifact_id = current.artifact_id
      INNER JOIN books b ON b.id = current.book_id AND b.user_id = artifact.user_id
      WHERE artifact.user_id = ? AND artifact.checksum = ? AND artifact.status = 'active'
      LIMIT 1
    `).get(ownerId, checksum) as unknown as DuplicateBookProjection | undefined;
    return row ?? null;
  }
}
