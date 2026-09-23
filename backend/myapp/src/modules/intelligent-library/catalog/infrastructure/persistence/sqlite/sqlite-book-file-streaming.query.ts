import { Injectable } from "@nestjs/common";
import { SqliteService } from "../../../../../../platform/persistence/sqlite/sqlite.service";
import { StorageService } from "../../../../../../platform/storage/storage.service";
import type {
  BookFileStreamingProjection,
  BookFileStreamingQuery,
  BookFileStreamingQueryPort,
} from "../../../application/ports/book-file-streaming-query.port";

@Injectable()
export class SqliteBookFileStreamingQuery implements BookFileStreamingQueryPort {
  constructor(
    private readonly sqliteService: SqliteService,
    private readonly storageService: StorageService,
  ) {}

  findForStreaming(query: Readonly<BookFileStreamingQuery>): BookFileStreamingProjection | null {
    const row = this.sqliteService.getDatabase().prepare(`
      SELECT artifact.stored_path, artifact.mime_type
      FROM book_current_artifacts current
      INNER JOIN book_artifacts artifact ON artifact.artifact_id = current.artifact_id
      WHERE artifact.user_id = ? AND current.book_id = ? AND artifact.status = 'active'
      LIMIT 1
    `).get(query.userId, query.bookId) as unknown as {
      stored_path: string;
      mime_type: string | null;
    } | undefined;
    if (!row) return null;
    return {
      absolutePath: this.storageService.resolvePath(row.stored_path),
      mimeType: row.mime_type,
      downloadStatus: "completed",
    };
  }
}
