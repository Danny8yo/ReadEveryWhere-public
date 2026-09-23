import { Injectable } from "@nestjs/common";
import { StorageService } from "../../../../platform/storage/storage.service";
import { SqliteService } from "../../../../platform/persistence/sqlite/sqlite.service";
import type {
  AttachBookFileCommand,
  AttachBookFilePort,
  AttachedBookFileProjection,
  BookFileStatusQueryPort,
  BookSourceReferenceProjection,
  BookSourceReferenceQueryPort,
  ExistingBookFileProjection,
  DetachBookFileCommand,
} from "../../public";
import { AttachBookFileUseCase } from "../application/use-cases/attach-book-file.use-case";
import { DetachBookFileUseCase } from "../application/use-cases/detach-book-file.use-case";

@Injectable()
export class CatalogAcquisitionAdapter implements
  BookSourceReferenceQueryPort,
  BookFileStatusQueryPort,
  AttachBookFilePort
{
  constructor(
    private readonly sqliteService: SqliteService,
    private readonly storageService: StorageService,
    private readonly attachBookFile: AttachBookFileUseCase,
    private readonly detachBookFile: DetachBookFileUseCase,
  ) {}

  findForDownload(query: { userId: number; bookId: number }): BookSourceReferenceProjection | null {
    const row = this.sqliteService.getDatabase().prepare(`
      SELECT source_book_id, hash
      FROM source_refs
      WHERE user_id = ? AND book_id = ?
      ORDER BY is_primary DESC, id ASC
      LIMIT 1
    `).get(query.userId, query.bookId) as unknown as {
      source_book_id: string;
      hash: string | null;
    } | undefined;
    return row ? { sourceBookId: row.source_book_id, hash: row.hash } : null;
  }

  findExisting(query: { userId: number; bookId: number }): ExistingBookFileProjection | null {
    const row = this.sqliteService.getDatabase().prepare(`
      SELECT artifact.stored_path
      FROM book_current_artifacts current
      INNER JOIN book_artifacts artifact ON artifact.artifact_id = current.artifact_id
      WHERE artifact.user_id = ? AND current.book_id = ? AND artifact.status = 'active'
      LIMIT 1
    `).get(query.userId, query.bookId) as unknown as {
      stored_path: string;
    } | undefined;
    if (!row) return null;
    return {
      storedPath: row.stored_path,
      absolutePath: this.storageService.resolvePath(row.stored_path),
    };
  }

  attach(command: Readonly<AttachBookFileCommand>): Promise<AttachedBookFileProjection> {
    return this.attachBookFile.execute(command);
  }

  detach(command: Readonly<DetachBookFileCommand>): void {
    this.detachBookFile.execute(command);
  }
}
