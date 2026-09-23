import { normalizeLibraryQuery } from '../domain/queryCache';
import { libraryVersion } from './librarySyncApi';
import { mapLibraryBook } from './mappers';
import type { LibraryBookDto } from './dto';
import type { ImportBookResult } from '../model/library';
import type { LibraryBook, BatchImportBookResult, LibraryListResponse, AddBookManualParams, AddFromSearchParams } from '../model/library';
import { request, requestFormData } from '../../../services/apiClient';
import type { BookReadingGenre, FormalBookReadingProfile } from '../../metadata/model/bookAnalysis';
import type { EbookFormat } from '../../../utils/bookFormat';
export const fetchLibraryBooks = (params: {
    page?: number;
    pageSize?: number;
    keyword?: string;
    primaryGenre?: BookReadingGenre;
    secondaryGenre?: BookReadingGenre;
    formats?: EbookFormat[];
} = {}): Promise<LibraryListResponse> => {
    return request<Omit<LibraryListResponse, 'items'> & {
        items: LibraryBookDto[];
    }>('/api/v1/library/books', {
        method: 'GET',
        params:normalizeLibraryQuery(params),
    }).then(data => { libraryVersion(data.libraryVersion); if(!Number.isSafeInteger(data.progressSequence)||Number(data.progressSequence)<0||data.items.some(b=>b.downloadTaskId!==null && (!Number.isSafeInteger(b.downloadTaskId)||Number(b.downloadTaskId)<1))) throw new Error('书库同步接口不兼容，请刷新页面并确认服务器版本'); return { ...data, items: data.items.map(mapLibraryBook) }; });
};
export const getBookReadingProfile = (id: number): Promise<FormalBookReadingProfile> => request<FormalBookReadingProfile>(`/api/v1/library/books/${id}/reading-profile`, { method: 'GET' });
export const updateBookReadingProfile = (id: number, data: {
    primaryGenre?: BookReadingGenre | null;
    secondaryGenres?: BookReadingGenre[];
    classificationSummary?: string | null;
}): Promise<FormalBookReadingProfile> => request<FormalBookReadingProfile>(`/api/v1/library/books/${id}/reading-profile`, { method: 'PATCH', body: JSON.stringify(data) });
export const clearBookReadingProfile = (id: number): Promise<FormalBookReadingProfile> => request<FormalBookReadingProfile>(`/api/v1/library/books/${id}/reading-profile`, { method: 'DELETE' });
export const addBookManual = (params: AddBookManualParams): Promise<LibraryBook> => {
    return request<LibraryBookDto>('/api/v1/library/books', {
        method: 'POST',
        body: JSON.stringify(params),
    }).then(mapLibraryBook);
};
export interface ImportBookParams {
    file: File;
    title?: string;
    authors?: string;
    isbn?: string;
    coverUrl?: string;
    conflictPolicy?: 'rename' | 'skip' | 'overwrite';
}
export interface ImportCapabilities {
    maxFileSizeBytes: number;
}
export const getImportCapabilities = (): Promise<ImportCapabilities> => {
    return request<ImportCapabilities>('/api/v1/library/books/import-capabilities', {
        method: 'GET',
        cache: 'no-store',
    });
};
export const importBook = (params: ImportBookParams): Promise<LibraryBook> => {
    const formData = new FormData();
    formData.append('file', params.file);
    if (params.title)
        formData.append('title', params.title);
    if (params.authors)
        formData.append('authors', params.authors);
    if (params.isbn)
        formData.append('isbn', params.isbn);
    if (params.coverUrl)
        formData.append('coverUrl', params.coverUrl);
    if (params.conflictPolicy)
        formData.append('conflictPolicy', params.conflictPolicy);
    return requestFormData<ImportBookResult>('/api/v1/library/books/import', formData, 'POST')
        .then((result) => mapLibraryBook(result.book));
};
export const importBookWithMetadata = (params: ImportBookParams): Promise<ImportBookResult> => {
    const formData = new FormData();
    formData.append('file', params.file);
    if (params.title)
        formData.append('title', params.title);
    if (params.authors)
        formData.append('authors', params.authors);
    if (params.isbn)
        formData.append('isbn', params.isbn);
    if (params.coverUrl)
        formData.append('coverUrl', params.coverUrl);
    if (params.conflictPolicy)
        formData.append('conflictPolicy', params.conflictPolicy);
    return requestFormData<ImportBookResult>('/api/v1/library/books/import', formData, 'POST').then(result => ({...result, book:mapLibraryBook(result.book)}));
};
export const importBooksBatch = (params: {
    files: File[];
    conflictPolicy?: 'rename' | 'skip' | 'overwrite';
}): Promise<BatchImportBookResult> => {
    const formData = new FormData();
    params.files.forEach((file) => formData.append('files', file));
    if (params.conflictPolicy)
        formData.append('conflictPolicy', params.conflictPolicy);
    return requestFormData<BatchImportBookResult>('/api/v1/library/books/import/batch', formData, 'POST').then(result => ({...result,items:result.items.map(item => item.book ? {...item,book:mapLibraryBook(item.book)} : item)}));
};
export const updateLibraryBook = (id: number, data: Partial<LibraryBook>): Promise<LibraryBook> => {
    return request<LibraryBookDto>(`/api/v1/library/books/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
    }).then(mapLibraryBook);
};
export const deleteLibraryBook = (id: number): Promise<{
    deleted: boolean;
    bookId: number;
}> => {
    return request<{
        deleted: boolean;
        bookId: number;
    }>(`/api/v1/library/books/${id}`, {
        method: 'DELETE',
    });
};
export const batchDeleteLibraryBooks = (ids: number[]): Promise<{
    requestedCount: number;
    deletedCount: number;
    deletedIds: number[];
    skippedIds: number[];
}> => {
    return request<{
        requestedCount: number;
        deletedCount: number;
        deletedIds: number[];
        skippedIds: number[];
    }>('/api/v1/library/books/batch-delete', {
        method: 'POST',
        body: JSON.stringify({ ids }),
    });
};
export interface BookFileAccessResponse {
    url: string;
    expiresAt: string;
}
export const createBookFileAccessUrl = (id: number): Promise<BookFileAccessResponse> => {
    return request<BookFileAccessResponse>(`/api/v1/library/books/${id}/file-access`, {
        method: 'POST',
    });
};
export const addToLibraryFromSearch = (params: AddFromSearchParams): Promise<LibraryBook> => {
    return request<LibraryBookDto>('/api/v1/library/books/from-search', {
        method: 'POST',
        body: JSON.stringify(params),
    }).then(mapLibraryBook);
};
export const getLibraryBook = (id: number): Promise<LibraryBook> => request<LibraryBookDto>(`/api/v1/library/books/${id}`).then(mapLibraryBook);
