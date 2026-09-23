import type { BookAnalysisDetail, BookAnalysisSummary } from '../model/bookAnalysis';
import { genreDisplayLabel } from './analysisState';
export function toAnalysisSummary(detail: BookAnalysisDetail): BookAnalysisSummary {
    const profile = detail.candidate;
    return {
        status: detail.status,
        candidateId: profile?.status === 'pending' ? profile.id ?? null : null,
        primaryGenre: profile?.primaryGenre ?? null,
        displayLabel: profile ? genreDisplayLabel(profile.primaryGenre) : null,
        confidence: profile?.confidence ?? null,
        analyzedAt: profile?.analyzedAt ?? null,
        stale: detail.stale,
    };
}
