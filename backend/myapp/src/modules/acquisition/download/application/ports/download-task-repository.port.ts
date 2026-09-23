import type {
  CreateDownloadTaskInput,
  DownloadTask,
  DownloadTaskStatus,
} from "../../domain/download.types";

export interface DownloadTaskRepositoryPort {
  createTask(input: Readonly<CreateDownloadTaskInput>): DownloadTask;
  findTaskByIdForUser(userId: number, taskId: number): DownloadTask | null;
  findTaskById(taskId: number): DownloadTask | null;
  markDownloading(taskId: number): void;
  markFailed(taskId: number, message: string): void;
  markCompleted(taskId: number, localPath: string): void;
  recordCompletionWarning(taskId: number, message: string): void;
  updateProgress(taskId: number, progress: number): void;
  cancelTask(userId: number, taskId: number): boolean;
  updateTask(
    taskId: number,
    status: DownloadTaskStatus,
    progress: number,
    errorMessage: string | null,
    localPath: string | null,
    phase?: DownloadTask["phase"],
  ): void;
}

export const DOWNLOAD_TASK_REPOSITORY_PORT = Symbol("ACQUISITION_DOWNLOAD_TASK_REPOSITORY_PORT");
