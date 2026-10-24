import type { SearchResultItem, SearchResponse } from '../model/book';
import type { EbookFormat } from '../../../shared/utils/bookFormat';
export interface SearchErrorState {
    code: number;
    message: string;
    requestId: string | null;
    details: {
        field: string | null;
        reason: string | null;
    } | null;
}
const createEmptyPagination = (pageSize = 20): SearchResponse => ({
    items: [],
    total: 0,
    page: 1,
    pageSize,
    hasNext: false,
    nextPage: null,
    totalPages: 1,
    requestId: '',
});
import { isSearchServiceError } from './searchError';
import type { SearchQuery } from '../model/book';
export function createSearchState() {
    return {
        loading: false,
        results: [] as SearchResultItem[],
        pagination: createEmptyPagination() as SearchResponse,
        searchKeyword: '',
        searchQuery: '',
        lastRequestId: null as string | null,
        lastSearchedAt: null as string | null,
        error: null as SearchErrorState | null,
        hasSearched: false,
        selectedFormats: [] as EbookFormat[],
    };
}
export function createSearchController(state: ReturnType<typeof createSearchState>, searchBooksRemote: (query: SearchQuery) => Promise<SearchResponse>, newId: () => string) {
    const doubanRatingCache = new Map<string, NonNullable<SearchResultItem['doubanRating']>>();
    const applyCachedDoubanRatings = (items: SearchResultItem[]): SearchResultItem[] => (items.map((item) => {
        const cached = doubanRatingCache.get(item.id) ?? doubanRatingCache.get(item.sourceBookId);
        return cached ? { ...item, doubanRating: cached } : item;
    }));
    const resetResults = (pageSize = 20) => {
        state.results = [];
        state.pagination = createEmptyPagination(pageSize);
    };
    const clearSearch = () => {
        state.loading = false;
        state.error = null;
        state.searchKeyword = '';
        state.searchQuery = '';
        state.lastRequestId = null;
        state.lastSearchedAt = null;
        state.hasSearched = false;
        state.selectedFormats = [];
        resetResults();
    };
    const searchBooks = async (query: string, page = 1, pageSize = 20) => {
        const keyword = query.trim();
        state.error = null;
        if (!keyword) {
            clearSearch();
            return;
        }
        state.loading = true;
        state.searchKeyword = keyword;
        state.searchQuery = keyword;
        state.hasSearched = true;
        state.lastRequestId = newId();
        const requestId = state.lastRequestId;
        try {
            const response = await searchBooksRemote({
                keyword,
                page,
                pageSize,
                sourcePlatform: 'zlibrary',
                formats: state.selectedFormats,
                requestId,
            });
            if (state.lastRequestId !== requestId)
                return;
            state.results = applyCachedDoubanRatings(response.items);
            state.pagination = {
                items: response.items,
                total: response.total,
                page: response.page,
                pageSize: response.pageSize,
                hasNext: response.hasNext,
                nextPage: response.nextPage,
                totalPages: response.totalPages ?? Math.ceil(response.total / response.pageSize),
                requestId: response.requestId,
            };
            state.lastSearchedAt = new Date().toISOString();
        }
        catch (caughtError) {
            if (state.lastRequestId !== requestId)
                return;
            resetResults(pageSize);
            if (isSearchServiceError(caughtError)) {
                state.error = {
                    code: caughtError.code,
                    message: caughtError.message,
                    requestId: caughtError.requestId,
                    details: caughtError.details,
                };
            }
            else {
                state.error = {
                    code: 50001,
                    message: '系统繁忙，请稍后重试',
                    requestId: null,
                    details: null,
                };
            }
        }
        finally {
            if (state.lastRequestId === requestId) {
                state.loading = false;
            }
        }
    };
    const goToPage = (page: number) => {
        if (state.searchKeyword) {
            searchBooks(state.searchKeyword, page, state.pagination.pageSize);
        }
    };
    const nextPage = () => {
        if (state.pagination.hasNext && state.pagination.nextPage !== null) {
            goToPage(state.pagination.nextPage);
        }
    };
    const prevPage = () => {
        if (state.pagination.page > 1) {
            goToPage(state.pagination.page - 1);
        }
    };
    const rememberDoubanRating = (bookId: string, rating: NonNullable<SearchResultItem['doubanRating']>) => {
        doubanRatingCache.set(bookId, rating);
        const matched = state.results.find((item) => item.id === bookId);
        if (matched) {
            doubanRatingCache.set(matched.sourceBookId, rating);
        }
        state.results = state.results.map((book) => (book.id === bookId ? { ...book, doubanRating: rating } : book));
    };
    return { searchBooks, clearSearch, rememberDoubanRating, goToPage, nextPage, prevPage };
}
