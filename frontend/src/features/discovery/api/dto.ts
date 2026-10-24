import type { SourcePlatform, SearchAvailability } from '../model/book';
import type { EbookFormat } from '../../../shared/utils/bookFormat';
export interface SearchApiBook {
    id: string | number;
    sourceBookId?: string | number | null;
    sourcePlatform?: SourcePlatform | string;
    title: string;
    authors: string[];
    publisher?: string | null;
    publishYear?: number | null;
    identifier?: string | null;
    language?: string | null;
    formats?: EbookFormat[];
    fileSize?: number | null;
    fileSizeText?: string | null;
    coverUrl?: string | null;
    description?: string | null;
    downloadPath?: string | null;
    sourceUrl?: string | null;
    detailUrl?: string | null;
    readOnlineUrl?: string | null;
    readOnlineAvailable?: boolean;
    downloadable?: boolean;
    availability?: SearchAvailability;
    md5?: string | null;
    sha256?: string | null;
    zlibraryInterestScore?: number | null;
    zlibraryQualityScore?: number | null;
    raw?: Record<string, unknown> | null;
    hash?: string | null;
}
export interface SearchPageResult {
    items: SearchApiBook[];
    total: number;
    page: number;
    pageSize: number;
    hasNext: boolean;
    nextPage: number | null;
    totalPages: number | null;
    requestId: string;
}
