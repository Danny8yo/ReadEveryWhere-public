import type { ScrapedResult, MatchedMetadataCandidate, DoubanRatingCandidate, SavedDoubanRating } from '../model/metadata';
import { request } from '../../../services/apiClient';
import type { LibraryBook } from '../../library/model/library';
export const scrapeMetadata = (input: {
    provider: 'zlibrary' | 'douban';
    keyword: string;
    bookId: number;
} | {
    provider: 'AI';
    bookId: number;
}): Promise<MatchedMetadataCandidate[]> => request<MatchedMetadataCandidate[]>('/api/v1/metadata/scrape', {
    method: 'POST',
    body: JSON.stringify(input.provider === 'AI' ? input : { ...input, keyword: input.keyword.trim() }),
});
export const applyMetadataToBook = (bookId: number, expectedVersion: number, data: ScrapedResult): Promise<LibraryBook> => {
    return request<LibraryBook>(`/api/v1/metadata/books/${bookId}`, {
        method: 'PATCH',
        body: JSON.stringify({
            expectedVersion,
            title: data.title,
            authors: data.authors,
            isbn: data.isbn,
            language: data.language,
            coverUrl: data.coverUrl,
            description: data.description,
            publisher: data.publisher,
            publishYear: data.publishYear,
            editionTag: data.editionTag,
            sourcePlatform: data.sourcePlatform,
            sourceBookId: data.sourceBookId,
            sourceUrl: data.sourceUrl,
        }),
    });
};
export const searchDoubanRatingCandidates = (keyword: string): Promise<DoubanRatingCandidate[]> => {
    return request<DoubanRatingCandidate[]>(`/api/v1/metadata/douban-rating?q=${encodeURIComponent(keyword)}`);
};
export const saveBookDoubanRating = (bookId: number, candidate: DoubanRatingCandidate): Promise<SavedDoubanRating> => request<SavedDoubanRating>(`/api/v1/metadata/books/${bookId}/douban-rating`, { method: 'PUT', body: JSON.stringify(candidate) });
