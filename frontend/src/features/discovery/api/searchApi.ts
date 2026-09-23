import { randomId } from '../../../services/randomId';
import { SearchServiceError } from '../domain/searchError';
import type { SearchQuery, SearchResponse } from '../model/book';
import type { SearchPageResult } from './dto';
import { mapSearchApiBookToInternal } from './mappers';
import { request } from '../../../services/apiClient';
const mapErrorMessage = (code: number, fallbackMessage: string): string => {
    if (code === 40002)
        return '请输入有效关键词';
    if (code === 40101)
        return '请先登录后再试';
    if (code === 50002)
        return '搜索源暂不可用，请稍后再试';
    if (code === 50001)
        return '系统繁忙，请稍后重试';
    return fallbackMessage || '搜索失败，请稍后重试';
};
export const searchBooksRemote = async (query: SearchQuery): Promise<SearchResponse> => {
    try {
        const data = await request<SearchPageResult>('/api/v1/search/books', {
            method: 'POST',
            body: JSON.stringify({
                keyword: query.keyword,
                page: query.page,
                pageSize: query.pageSize,
                sourcePlatform: query.sourcePlatform,
                formats: query.formats,
                requestId: query.requestId ?? randomId(),
            }),
        });
        return {
            items: data.items.map((book) => mapSearchApiBookToInternal(book)),
            total: data.total,
            page: data.page,
            pageSize: data.pageSize,
            hasNext: data.hasNext,
            nextPage: data.nextPage,
            totalPages: data.totalPages,
            requestId: data.requestId,
        };
    }
    catch (error: any) {
        if (error.code !== undefined) {
            throw new SearchServiceError(error.code, mapErrorMessage(error.code, error.message), error.requestId ?? null, error.details ?? null);
        }
        throw new SearchServiceError(50001, '系统繁忙，请稍后重试', null);
    }
};
