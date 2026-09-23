export interface ScrapedResult {
    id?: string;
    title: string;
    authors: string[];
    publishYear: number | null;
    coverUrl: string | null;
    description: string | null;
    publisher: string | null;
    isbn: string | null;
    language: string | null;
    editionTag: string | null;
    sourcePlatform: string;
    sourceBookId: string;
    sourceUrl: string | null;
}
export type MetadataProvider = 'zlibrary' | 'douban' | 'AI';
export type MetadataMatchLevel = 'edition' | 'work' | 'ambiguous' | 'conflict';
export type MetadataMatchSignal = 'content_derived' | 'isbn_exact' | 'title_exact' | 'title_close' | 'author_overlap';
export type MetadataMatchConflict = 'isbn_mismatch' | 'title_mismatch' | 'author_mismatch';
export interface MatchedMetadataCandidate {
    candidate: ScrapedResult;
    match: {
        level: MetadataMatchLevel;
        signals: MetadataMatchSignal[];
        conflicts: MetadataMatchConflict[];
    };
}
export interface DoubanRatingCandidate {
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
}
export interface SavedDoubanRating {
    provider: 'douban';
    sourceBookId: string;
    sourceUrl: string;
    sourceTitle: string | null;
    rating: number | null;
    ratingCount: number | null;
    fetchedAt: string;
}
