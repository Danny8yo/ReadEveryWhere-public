import type { SourcePlatform } from "../../public";

export type DownloadPlatform = SourcePlatform;

export type DownloadTaskStatus = "queued" | "downloading" | "completed" | "failed" | "canceled";

export interface DownloadTask {
  id: number;
  userId: number;
  bookId: number;
  sourcePlatform: DownloadPlatform;
  sourceUrl: string;
  requestedFileName: string | null;
  hash: string | null;
  sourceBookId: string | null;
  deliveryId?: string;
  phase?: "queued" | "downloading" | "delivering" | "completed" | "failed" | "canceled";
  status: DownloadTaskStatus;
  progress: number;
  localPath: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDownloadTaskInput {
  userId: number;
  bookId: number;
  sourcePlatform: DownloadPlatform;
  sourceUrl: string;
  requestedFileName: string | null;
  hash: string | null;
  sourceBookId: string | null;
  deliveryId?: string;
}
