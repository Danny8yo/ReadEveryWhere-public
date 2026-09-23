import {
  LIBRARY_PROJECTION_CHANGE_PORT,
  type LibraryProjectionChangePort,
} from "../../../intelligent-library/public/library-projection-change.port";
import {
  afterCommit,
  transact,
} from "../../../../platform/persistence/sqlite/transaction";
import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { SqliteService } from "../../../../platform/persistence/sqlite/sqlite.service";
import type { DownloadTaskRepositoryPort } from "../application/ports/download-task-repository.port";
import type {
  CreateDownloadTaskInput,
  DownloadTask,
  DownloadTaskStatus,
} from "../domain/download.types";

interface DownloadTaskRow {
  id: number;
  user_id: number;
  book_id: number;
  source_platform: string;
  source_url: string;
  requested_file_name: string | null;
  hash: string | null;
  source_book_id: string | null;
  delivery_id: string | null;
  phase: string | null;
  status: string;
  progress: number;
  local_path: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class SqliteDownloadTaskRepository
  implements DownloadTaskRepositoryPort
{
  constructor(
    private readonly sqliteService: SqliteService,
    @Inject(LIBRARY_PROJECTION_CHANGE_PORT)
    private readonly changes: LibraryProjectionChangePort,
  ) {}

  createTask(input: Readonly<CreateDownloadTaskInput>): DownloadTask {
    const database = this.sqliteService.getDatabase();
    const now = new Date().toISOString();
    const result = database
      .prepare(
        `
      INSERT INTO download_tasks (
        user_id, book_id, source_platform, source_url, requested_file_name,
        hash, source_book_id, delivery_id, phase, status, progress, local_path, error_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 'queued', 0, NULL, NULL, ?, ?)
    `,
      )
      .run(
        input.userId,
        input.bookId,
        input.sourcePlatform,
        input.sourceUrl,
        input.requestedFileName,
        input.hash,
        input.sourceBookId,
        input.deliveryId ?? randomUUID(),
        now,
        now,
      ) as { lastInsertRowid?: number | bigint };
    const task = this.findTaskById(Number(result.lastInsertRowid ?? 0));
    if (!task) throw new Error("Failed to load created download task");
    afterCommit(database, () => this.changes.changed(task.userId, task.id));
    return task;
  }

  findTaskByIdForUser(userId: number, taskId: number): DownloadTask | null {
    const row = this.sqliteService
      .getDatabase()
      .prepare(
        "SELECT * FROM download_tasks WHERE id = ? AND user_id = ? LIMIT 1",
      )
      .get(taskId, userId) as unknown as DownloadTaskRow | undefined;
    return row ? mapTask(row) : null;
  }

  findTaskById(taskId: number): DownloadTask | null {
    const row = this.sqliteService
      .getDatabase()
      .prepare("SELECT * FROM download_tasks WHERE id = ? LIMIT 1")
      .get(taskId) as unknown as DownloadTaskRow | undefined;
    return row ? mapTask(row) : null;
  }

  markDownloading(taskId: number): void {
    this.updateTask(taskId, "downloading", 0, null, null, "downloading");
  }

  markFailed(taskId: number, message: string): void {
    const current = this.findTaskById(taskId);
    this.updateTask(
      taskId,
      "failed",
      current?.progress ?? 0,
      message,
      current?.localPath ?? null,
      "failed",
    );
  }

  markCompleted(taskId: number, localPath: string): void {
    this.updateTask(taskId, "completed", 100, null, localPath, "completed");
  }

  recordCompletionWarning(taskId: number, message: string): void {
    const current = this.findTaskById(taskId);
    if (!current) throw new Error(`Download task ${taskId} missing`);
    const result = this.sqliteService
      .getDatabase()
      .prepare(
        "UPDATE download_tasks SET error_message = ?, updated_at = ? WHERE id = ? AND status = 'completed'",
      )
      .run(message, new Date().toISOString(), taskId);
    // updated_at participates in the latest-task read model, even though the warning itself is not displayed.
    if (result.changes > 0)
      afterCommit(this.sqliteService.getDatabase(), () =>
        this.changes.changed(current.userId, taskId),
      );
  }

  updateProgress(taskId: number, progress: number): void {
    const current = this.findTaskById(taskId);
    if (!current) throw new Error(`Download task ${taskId} missing`);
    const clamped = Math.max(0, Math.min(100, Math.round(progress)));
    if (
      current.progress === clamped ||
      !["queued", "downloading"].includes(current.status)
    )
      return;
    this.sqliteService
      .getDatabase()
      .prepare(
        "UPDATE download_tasks SET progress = ?, updated_at = ? WHERE id = ?",
      )
      .run(clamped, new Date().toISOString(), taskId);
    afterCommit(this.sqliteService.getDatabase(), () =>
      this.changes.progress({
        userId: current.userId,
        bookId: current.bookId,
        taskId,
        progress: clamped,
      }),
    );
  }

  cancelTask(userId: number, taskId: number): boolean {
    const result = this.sqliteService
      .getDatabase()
      .prepare(
        "UPDATE download_tasks SET status = 'canceled', updated_at = ? WHERE id = ? AND user_id = ? AND status IN ('queued', 'downloading')",
      )
      .run(new Date().toISOString(), taskId, userId) as { changes?: number };
    const changed = Number(result.changes ?? 0) > 0;
    if (changed)
      afterCommit(this.sqliteService.getDatabase(), () =>
        this.changes.changed(userId, taskId),
      );
    return changed;
  }

  updateTask(
    taskId: number,
    status: DownloadTaskStatus,
    progress: number,
    errorMessage: string | null,
    localPath: string | null,
    phase: DownloadTask["phase"] = status,
  ): void {
    const current = this.findTaskById(taskId);
    if (!current) throw new Error(`Download task ${taskId} missing`);
    this.sqliteService
      .getDatabase()
      .prepare(
        "UPDATE download_tasks SET status = ?, phase = ?, progress = ?, error_message = ?, local_path = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        status,
        phase,
        progress,
        errorMessage,
        localPath,
        new Date().toISOString(),
        taskId,
      );
    afterCommit(this.sqliteService.getDatabase(), () =>
      this.changes.changed(current.userId, taskId),
    );
  }
}

function mapTask(row: DownloadTaskRow): DownloadTask {
  return {
    id: row.id,
    userId: row.user_id,
    bookId: row.book_id,
    sourcePlatform: row.source_platform as DownloadTask["sourcePlatform"],
    sourceUrl: row.source_url,
    requestedFileName: row.requested_file_name,
    hash: row.hash,
    sourceBookId: row.source_book_id,
    deliveryId: row.delivery_id ?? undefined,
    phase: (row.phase ?? row.status) as DownloadTask["phase"],
    status: row.status as DownloadTaskStatus,
    progress: row.progress,
    localPath: row.local_path,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
