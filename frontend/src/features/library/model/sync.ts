export interface LibraryVersion {
  epoch: string;
  revision: number;
}
export interface DownloadProgressEvent {
  epoch: string;
  sequence: number;
  bookId: number;
  taskId: number;
  progress: number;
}
