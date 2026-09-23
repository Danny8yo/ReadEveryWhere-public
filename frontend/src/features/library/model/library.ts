import type { BookAnalysisSummary, FormalBookReadingProfile } from '../../metadata/model/bookAnalysis';
import type { EbookFormat } from '../../../utils/bookFormat';
export interface LibraryBook {
    id: number;
    userId: number;
    title: string;
    authors: string[];
    authorsText: string;
    isbn: string | null;
    language: string | null;
    coverUrl: string | null;
    description: string | null;
    publisher: string | null;
    sourcePlatform: string;
    sourceBookId: string | null;
    sourceUrl: string | null;
    publishYear: number | null;
    editionTag: string | null;
    version: number;
    createdAt: string;
    updatedAt: string;
    fileName?: string | null;
    fileSize: number | null;
    isDownloaded: boolean;
    fileUrl?: string | null;
    checksum?: string | null;
    mimeType?: string | null;
    format: EbookFormat | null;
    downloadStatus?: string | null;
    downloadProgress?: number | null;
    downloadTaskId?: number | null;
    bookAnalysis?: BookAnalysisSummary | null;
    readingProfile?: FormalBookReadingProfile;
    doubanRating: {
        sourcePlatform: 'douban';
        sourceBookId: string;
        sourceUrl: string;
        title: string | null;
        rating: number | null;
        ratingCount: number | null;
        fetchedAt: string;
    } | null;
}
export type MetadataStatus = 'none' | 'pending' | 'scraping' | 'candidates_found' | 'applied' | 'skipped' | 'failed';
export type ScrapeQueryStrategy = 'isbn' | 'title_author' | 'title' | 'filename';
export interface BatchImportBookResult {
    items: BatchImportBookResultItem[];
    importedCount: number;
    failedCount: number;
}
export interface LibraryListResponse {
    libraryVersion?: import('./sync').LibraryVersion;
    progressSequence?: number;
    items: LibraryBook[];
    total: number;
    page: number;
    pageSize: number;
}
export interface AddBookManualParams {
    title: string;
    authors: string[];
    sourcePlatform?: string;
    sourceBookId?: string;
    sourceUrl?: string;
    coverUrl?: string;
    description?: string;
    isbn?: string;
    language?: string;
    publishYear?: number;
    editionTag?: string;
}
export interface AddFromSearchParams {
    title: string;
    authors: string[];
    sourcePlatform: string;
    sourceBookId: string;
    sourceUrl?: string;
    coverUrl?: string;
    description?: string;
    isbn?: string;
    publishYear?: number;
    editionTag?: string;
    hash?: string | null;
    format: EbookFormat;
}
export interface BatchImportBookResultItem {
    index: number;
    originalFileName: string;
    importStatus: 'imported' | 'failed';
    metadataStatus: MetadataStatus;
    scrapeQuery?: string;
    scrapeQueryStrategy?: ScrapeQueryStrategy;
    storedFileName?: string | null;
    book?: LibraryBook;
    error?: string;
}
export interface ImportBookResult {
    importStatus: 'imported';
    metadataStatus: MetadataStatus;
    scrapeQuery: string;
    scrapeQueryStrategy: ScrapeQueryStrategy;
    originalFileName: string;
    storedFileName: string | null;
    book: LibraryBook;
}
