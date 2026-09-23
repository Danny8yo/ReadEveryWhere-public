export interface ReaderBook {
    id: number;
    userId: number;
    title: string;
    authors: string[];
    coverUrl: string | null;
    fileName: string | null;
    fileUrl: string;
    isDownloaded: boolean;
    mimeType: string | null;
    checksum?: string | null;
    /** 落库文件大小；阅读器据此决定 PDF 是整份下载还是按需分块。 */
    fileSize?: number | null;
    updatedAt: string;
    version: number;
}
