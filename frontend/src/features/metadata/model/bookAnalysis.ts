import type { ContentRevision } from '../../ai-reading/model/aiReading';
export const BOOK_READING_GENRES = [
    'technical',
    'argumentation',
    'narrative',
    'paper',
    'poetry',
    'popular-science',
    'self-help',
    'general',
] as const;
export type BookReadingGenre = typeof BOOK_READING_GENRES[number];
export interface FormalBookReadingProfile {
    id: string;
    primaryGenre: BookReadingGenre | null;
    secondaryGenres: BookReadingGenre[];
    traits: string[];
    confidence: {
        kind: 'ai-score' | 'user-determined' | null;
        score: number | null;
    };
    classificationSummary: string | null;
    profileVersion: number;
    updatedAt: string;
}
export type BookAnalysisStatus = 'not_analyzed' | 'pending' | 'running' | 'ready' | 'failed' | 'stale' | 'unsupported';
export interface BookReadingProfileCandidate {
    id: string;
    baseProfileVersion?: number;
    primaryGenre: BookReadingGenre;
    secondaryGenres: BookReadingGenre[];
    traits: string[];
    confidence: number;
    classificationSummary: string;
    contentRevision: ContentRevision;
    modelId: string;
    strategyVersion: string;
    analyzedAt: string;
    status: 'pending' | 'applied';
}
export interface BookAnalysisSummary {
    status: BookAnalysisStatus;
    primaryGenre: BookReadingGenre | null;
    displayLabel: string | null;
    confidence: number | null;
    analyzedAt: string | null;
    stale: boolean;
    candidateId?: string | null;
}
export interface BookAnalysisDetail {
    bookId: number;
    status: BookAnalysisStatus;
    stale: boolean;
    candidate: BookReadingProfileCandidate | null;
    errorCode: string | null;
}
export type BookAnalysisDisposition = 'accepted' | 'skipped' | 'rejected';
export interface BookAnalysisRequestResult {
    bookId: number;
    disposition?: BookAnalysisDisposition;
    outcome?: BookAnalysisDisposition;
    status: BookAnalysisStatus;
    taskId?: string | null;
    reason?: string | null;
    errorCode?: string | null;
}
export interface AnalyzeBookOptions {
    force?: boolean;
}
export interface AnalyzeBooksPayload extends AnalyzeBookOptions {
    bookIds: number[];
}
export interface BookAnalysisBatchResponse {
    items: BookAnalysisRequestResult[];
}
