import type { BookAnalysisStatus, BookAnalysisSummary, BookReadingGenre } from '../model/bookAnalysis';
const genreLabels: Record<BookReadingGenre, string> = {
    technical: '技术类',
    argumentation: '论证类',
    narrative: '叙事类',
    paper: '论文',
    poetry: '诗歌',
    'popular-science': '科普',
    'self-help': '自我提升',
    general: '通用',
};
const statusLabels: Record<BookAnalysisStatus, string> = {
    not_analyzed: '未分析',
    pending: '排队中',
    running: '分析中',
    ready: '已完成',
    failed: '失败',
    stale: '需重新分析',
    unsupported: '暂不支持 AI 预分析',
};
export const genreDisplayLabel = (genre: BookReadingGenre): string => genreLabels[genre];
export const statusDisplayLabel = (status: BookAnalysisStatus): string => statusLabels[status];
export const isBookAnalysisActive = (status: BookAnalysisStatus): boolean => (status === 'pending' || status === 'running');
export const isBookAnalysisReady = (analysis: Pick<BookAnalysisSummary, 'status' | 'stale'> | null | undefined): boolean => analysis?.status === 'ready' && analysis.stale === false;
