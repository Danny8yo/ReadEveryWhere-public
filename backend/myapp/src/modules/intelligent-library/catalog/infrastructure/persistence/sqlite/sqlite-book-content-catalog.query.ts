import { Injectable } from "@nestjs/common";
import { SqliteService } from "../../../../../../platform/persistence/sqlite/sqlite.service";
import { StorageService } from "../../../../../../platform/storage/storage.service";
import type {
  BookContentCatalogBookProjection,
  BookContentCatalogFileProjection,
  BookContentCatalogPort,
} from "../../../application/ports/book-content-catalog.port";
import { parseJsonStringArray } from "../../../domain/library.utils";

@Injectable()
export class SqliteBookContentCatalogQuery implements BookContentCatalogPort {
  constructor(
    private readonly sqliteService: SqliteService,
    private readonly storageService: StorageService,
  ) {}

  findById(userId: number, bookId: number): BookContentCatalogBookProjection | null {
    const row = this.sqliteService.getDatabase().prepare(`
      SELECT id, title, authors_json
      FROM books
      WHERE user_id = ? AND id = ?
      LIMIT 1
    `).get(userId, bookId) as unknown as {
      id: number;
      title: string;
      authors_json: string;
    } | undefined;
    return row
      ? { id: row.id, title: row.title, authors: parseJsonStringArray(row.authors_json, "books.authors_json") }
      : null;
  }

  findReadableFile(userId: number, bookId: number): BookContentCatalogFileProjection | null {
    const row = this.sqliteService.getDatabase().prepare(`
      SELECT artifact.artifact_id, artifact.checksum, artifact.stored_path, artifact.file_name, artifact.mime_type
      FROM book_current_artifacts current
      INNER JOIN book_artifacts artifact ON artifact.artifact_id = current.artifact_id
      WHERE artifact.user_id = ? AND current.book_id = ? AND artifact.status = 'active'
      LIMIT 1
    `).get(userId, bookId) as unknown as {
      artifact_id: string;
      checksum: string | null;
      stored_path: string;
      file_name: string;
      mime_type: string | null;
    } | undefined;
    if (!row) return null;
    return {
      artifactId: row.artifact_id,
      checksum: row.checksum,
      filePath: this.storageService.resolvePath(row.stored_path),
      fileName: row.file_name,
      mimeType: row.mime_type,
      downloadStatus: "completed",
    };
  }
}
