import type { BookAnalysisSummary } from '../../metadata/model/bookAnalysis';
import type { FormalBookReadingProfile } from '../../metadata/model/bookAnalysis';
import type { EbookFormat } from '../../../utils/bookFormat';
export type SourcePlatform = 'zlibrary';
export type SearchAvailability = 'available' | 'unavailable';
export interface SearchQuery {
    keyword: string;
    page: number;
    pageSize: number;
    sourcePlatform: SourcePlatform;
    requestId?: string | null;
    formats: EbookFormat[];
}
export interface SearchResultItem {
    id: string;
    sourceBookId: string;
    sourcePlatform: SourcePlatform;
    title: string;
    authors: string[];
    publisher: string | null;
    publishYear: number | null;
    identifier: string | null;
    isbn?: string | null;
    language: string | null;
    formats: EbookFormat[];
    fileSize: number | null;
    fileSizeText: string | null;
    coverUrl: string | null;
    description: string | null;
    downloadPath: string | null;
    detailUrl: string | null;
    readOnlineUrl: string | null;
    readOnlineAvailable: boolean;
    downloadable: boolean;
    availability: SearchAvailability;
    md5: string | null;
    sha256: string | null;
    zlibraryInterestScore: number | null;
    zlibraryQualityScore: number | null;
    doubanRating?: {
        sourcePlatform: 'douban';
        sourceBookId: string;
        sourceUrl: string;
        title: string | null;
        authors: string[];
        publisher: string | null;
        publishYear: number | null;
        isbn: string | null;
        rating: number | null;
        ratingCount: number | null;
        fetchedAt?: string;
    } | null;
    raw: Record<string, unknown> | null;
    hash?: string | null;
    bookAnalysis?: BookAnalysisSummary | null;
    readingProfile?: FormalBookReadingProfile;
}
export interface SearchResponse {
    items: SearchResultItem[];
    total: number;
    page: number;
    pageSize: number;
    hasNext: boolean;
    nextPage: number | null;
    totalPages: number | null;
    requestId: string;
}
