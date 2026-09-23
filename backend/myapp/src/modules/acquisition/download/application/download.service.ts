import { existsSync } from "node:fs";
import { basename } from "node:path";
import type {
  AttachBookFilePort,
  BookFileStatusQueryPort,
  BookOwnershipPort,
  BookSourceReferenceQueryPort,
} from "../../../intelligent-library/public";
import { AcquisitionError } from "../../domain/acquisition.error";
import { SourceRegistry } from "../../source-registry/application/source-registry";
import type { DownloadTask } from "../domain/download.types";
import type { DownloadTaskRepositoryPort } from "./ports/download-task-repository.port";

export interface CreateDownloadTaskCommand {
  bookId: number;
  sourcePlatform: "zlibrary";
  sourceUrl: string;
  fileName?: string;
}

export class DownloadService {
  constructor(
    private readonly tasks: DownloadTaskRepositoryPort,
    private readonly sources: SourceRegistry,
    private readonly ownership: BookOwnershipPort,
    private readonly sourceReferences: BookSourceReferenceQueryPort,
    private readonly files: BookFileStatusQueryPort,
    private readonly fileDelivery: AttachBookFilePort,
  ) {}

  async createTask(userId: number, command: CreateDownloadTaskCommand): Promise<DownloadTask> {
    if (!this.ownership.isOwnedByUser({ userId, bookId: command.bookId })) {
      throw AcquisitionError.notFound("bookId", "Book not found");
    }

    const sourceRef = this.sourceReferences.findForDownload({ userId, bookId: command.bookId });
    if (!sourceRef) {
      throw AcquisitionError.validation(
        "bookId",
        "Book has no zlibrary source reference, add the book via from-search first",
      );
    }
    if (!sourceRef.hash?.trim()) {
      throw AcquisitionError.validation("bookId", "Book source reference is missing hash");
    }
    const sourceUrl = command.sourceUrl?.trim() || `zlibrary:${sourceRef.sourceBookId}`;
    const task = this.tasks.createTask({
      userId,
      bookId: command.bookId,
      sourcePlatform: command.sourcePlatform,
      sourceUrl,
      hash: sourceRef.hash,
      sourceBookId: sourceRef.sourceBookId,
      requestedFileName: command.fileName?.trim() || null,
    });

    const existing = this.files.findExisting({ userId, bookId: command.bookId });
    if (existing && existsSync(existing.absolutePath)) {
      this.tasks.markCompleted(task.id, existing.storedPath);
      const completed = this.tasks.findTaskByIdForUser(userId, task.id);
      if (!completed) throw AcquisitionError.internal("Failed to load completed download task");
      return completed;
    }

    void this.processTask(task.id);
    return task;
  }

  getTask(userId: number, taskId: number): DownloadTask {
    const task = this.tasks.findTaskByIdForUser(userId, taskId);
    if (!task) throw AcquisitionError.notFound("taskId", "Download task not found");
    return task;
  }

  cancelTask(userId: number, taskId: number): { canceled: boolean } {
    const task = this.tasks.findTaskByIdForUser(userId, taskId);
    if (!task) throw AcquisitionError.notFound("taskId", "Download task not found");
    if (["completed", "failed", "canceled"].includes(task.status)) return { canceled: false };
    return { canceled: this.tasks.cancelTask(userId, taskId) };
  }

  private async processTask(taskId: number): Promise<void> {
    const task = this.tasks.findTaskById(taskId);
    if (!task || task.status === "canceled") return;
    let attachment: {
      userId: number;
      bookId: number;
      localPath: string;
      checksum: string;
    } | null = null;
    try {
      this.tasks.markDownloading(task.id);
      const running = this.tasks.findTaskById(task.id);
      if (!running || running.status === "canceled") return;
      const source = this.sources.downloadFor(running.sourcePlatform);
      if (!source) {
        throw AcquisitionError.validation(
          "sourcePlatform",
          `Unsupported download platform: ${running.sourcePlatform}`,
        );
      }
      const artifact = await source.download(running.sourceUrl, {
        userId: running.userId,
        bookId: running.bookId,
        requestedFileName: running.requestedFileName,
        sourceBookId: running.sourceBookId ?? "",
        hash: running.hash ?? "",
        onProgress: (progress) => {
          if (this.tasks.findTaskById(running.id)?.status === "downloading") {
            this.tasks.updateProgress(running.id, progress);
          }
        },
      });
      if (this.tasks.findTaskById(running.id)?.status !== "downloading") return;
      this.tasks.updateTask(task.id, "downloading", 100, null, running.localPath, "delivering");
      const delivered = await this.fileDelivery.attach({
        deliveryId: running.deliveryId,
        userId: running.userId,
        bookId: running.bookId,
        sourcePlatform: running.sourcePlatform,
        sourceUrl: running.sourceUrl,
        localPath: artifact.localPath,
        content: artifact.content,
        fileName: artifact.fileName || basename(artifact.localPath ?? artifact.fileName),
        mimeType: artifact.mimeType,
        fileSize: artifact.fileSize,
        checksum: artifact.checksum,
      });
      attachment = {
        userId: running.userId,
        bookId: running.bookId,
        localPath: delivered.localPath,
        checksum: delivered.checksum,
      };
      if (this.tasks.findTaskById(running.id)?.status !== "downloading") {
        this.fileDelivery.detach(attachment);
        attachment = null;
        return;
      }
      // Catalog delivery is the durable file-availability fact. If the task
      // projection write fails, keep the active artifact so a later replay or
      // a new task can observe it instead of destroying a successful delivery.
      this.tasks.markCompleted(task.id, delivered.storedPath);
      if (source.recordCompleted) {
        try {
          await source.recordCompleted(running.userId);
        } catch {
          this.tasks.recordCompletionWarning(
            task.id,
            "Source completion accounting failed",
          );
        }
      }
    } catch (error) {
      if (this.tasks.findTaskById(task.id)?.status === "canceled") return;
      this.tasks.markFailed(task.id, downloadFailureMessage(error));
    }
  }

  private detachSafely(attachment: {
    userId: number;
    bookId: number;
    localPath: string;
    checksum: string;
  }): void {
    try {
      this.fileDelivery.detach(attachment);
    } catch {
      // Preserve the original task failure; cleanup is best effort.
    }
  }
}

function downloadFailureMessage(error: unknown): string {
  if (error instanceof AcquisitionError) return error.message;
  if (!(error instanceof Error) || !isStructuredApplicationError(error)) return "Download failed";
  return error.details.upstream
    ? `${error.message} (upstream=${JSON.stringify(error.details.upstream)})`
    : error.message;
}

function isStructuredApplicationError(
  error: Error,
): error is Error & { status: number; code: number; details: { reason: string; upstream?: unknown } } {
  const candidate = error as Error & {
    status?: unknown;
    code?: unknown;
    details?: { reason?: unknown; upstream?: unknown };
  };
  return (
    typeof candidate.status === "number"
    && typeof candidate.code === "number"
    && typeof candidate.details?.reason === "string"
  );
}
