import { request } from '../../../shared/web/apiClient';
import type { AnalyzeBookOptions, AnalyzeBooksPayload, BookAnalysisBatchResponse, BookAnalysisDetail, BookAnalysisRequestResult } from '../model/bookAnalysis';
const BASE_PATH = '/api/v1/book-analysis';
export const bookAnalysisApi = {
    getBookAnalysis: (bookId: number): Promise<BookAnalysisDetail> => request<BookAnalysisDetail>(`${BASE_PATH}/books/${bookId}`),
    analyzeBook: (bookId: number, options: AnalyzeBookOptions = {}): Promise<BookAnalysisRequestResult> => request<BookAnalysisRequestResult>(`${BASE_PATH}/books/${bookId}`, {
        method: 'POST',
        body: JSON.stringify(options),
    }),
    analyzeBatch: (payload: AnalyzeBooksPayload): Promise<BookAnalysisBatchResponse> => request<BookAnalysisBatchResponse>(`${BASE_PATH}/batch`, {
        method: 'POST',
        body: JSON.stringify(payload),
    }),
    applyCandidate: (bookId: number, candidateId: string, override = false): Promise<unknown> => request(`${BASE_PATH}/books/${bookId}/apply`, {
        method: 'POST',
        body: JSON.stringify({ candidateId, override }),
    }),
};
