export interface CreateDownloadTaskParams {
    bookId: number;
    sourcePlatform: 'zlibrary';
    sourceUrl: string;
    fileName?: string;
}
export interface DownloadTask {
    id: number;
    userId: number;
    bookId: number;
    sourcePlatform: string;
    sourceUrl: string;
    requestedFileName: string | null;
    hash: string | null;
    sourceBookId: string | null;
    status: 'queued' | 'downloading' | 'completed' | 'failed' | 'canceled';
    progress: number;
    localPath: string | null;
    errorMessage: string | null;
    createdAt: string;
    updatedAt: string;
}
