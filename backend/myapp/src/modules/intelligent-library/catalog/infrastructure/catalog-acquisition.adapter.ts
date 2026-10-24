import { Injectable } from "@nestjs/common";
import { readFileSync } from "node:fs";
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
import { CatalogError } from "../domain/catalog.error";
import { detectEbookFormat, mimeTypeForEbookFormat } from "./ebook-format.validator";

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

  /**
   * Acquisition 交来的是上游下载的字节，文件名和 Content-Type 都由上游决定，不可信。
   * 与导入一致按魔数检测格式，MIME 只取检测结果；识别不了就拒绝，避免任意内容以
   * text/html 等类型入库后经文件路由在站点源下执行。
   */
  attach(command: Readonly<AttachBookFileCommand>): Promise<AttachedBookFileProjection> {
    const bytes = command.content ?? (command.localPath ? readFileSync(command.localPath) : null);
    const format = bytes ? detectEbookFormat(bytes, command.fileName) : null;
    if (!format) {
      return Promise.reject(CatalogError.validation("file", "下载的文件不是有效的 EPUB、PDF、MOBI 或 AZW3"));
    }
    return this.attachBookFile.execute({ ...command, mimeType: mimeTypeForEbookFormat(format) });
  }

  detach(command: Readonly<DetachBookFileCommand>): void {
    this.detachBookFile.execute(command);
  }
}
