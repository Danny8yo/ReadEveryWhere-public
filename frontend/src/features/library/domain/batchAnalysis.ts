import type { LibraryBook } from '../model/library';
import type { BookAnalysisDisposition, BookAnalysisStatus as BookAnalysisStatusValue, BookAnalysisDetail, BookAnalysisBatchResponse } from '../../metadata/model/bookAnalysis';
import { isBookAnalysisActive } from '../../metadata/domain/analysisState';
import type { Scheduler } from '../../../shared/domain/scheduler';
import { errorMessage } from '../../../shared/domain/errors';
interface BatchAnalysisViewItem {
    bookId: number;
    title: string;
    disposition: BookAnalysisDisposition;
    reason: string | null;
    seenStatuses: BookAnalysisStatusValue[];
}
export function createBatchAnalysisState() {
    return {
        isBatchAnalyzing: false,
        batchAnalysisResults: [] as BatchAnalysisViewItem[],
        batchAnalysisError: null as string | null,
    };
}
export function createBatchAnalysisController(state: ReturnType<typeof createBatchAnalysisState>, input: {
    books: LibraryBook[];
    selectedBookIds: number[];
    updateAnalysis(detail: BookAnalysisDetail): void;
}, api: {
    getBookAnalysis(id: number): Promise<BookAnalysisDetail>;
    analyzeBatch(input: {
        bookIds: number[];
        force: boolean;
    }): Promise<BookAnalysisBatchResponse>;
}, scheduler: Scheduler) {
    let generation = 0;
    let disposed = false;
    let batchAnalysisTimer: number | null = null;
    function stopBatchAnalysisPolling() {
        if (batchAnalysisTimer === null)
            return;
        scheduler.clearTimeout(batchAnalysisTimer);
        batchAnalysisTimer = null;
    }
    function appendBatchStatus(bookId: number, status: BookAnalysisStatusValue) {
        state.batchAnalysisResults = state.batchAnalysisResults.map((item) => (item.bookId !== bookId || item.seenStatuses.includes(status)
            ? item
            : { ...item, seenStatuses: [...item.seenStatuses, status] }));
    }
    function updateBookAnalysis(detail: BookAnalysisDetail) { input.updateAnalysis(detail); }
    async function pollBatchAnalysis() {
        stopBatchAnalysisPolling();
        const token = generation;
        const activeItems = state.batchAnalysisResults.filter((item) => (item.disposition === 'accepted'
            && item.seenStatuses.some(isBookAnalysisActive)
            && !item.seenStatuses.some((status) => status === 'ready' || status === 'failed' || status === 'stale')));
        if (activeItems.length === 0) {
            state.isBatchAnalyzing = false;
            return;
        }
        await Promise.all(activeItems.map(async (item) => {
            try {
                const detail = await api.getBookAnalysis(item.bookId);
                if (disposed || token !== generation)
                    return;
                appendBatchStatus(item.bookId, detail.status);
                updateBookAnalysis(detail);
            }
            catch (cause) {
                if (disposed || token !== generation)
                    return;
                state.batchAnalysisError = errorMessage(cause);
                appendBatchStatus(item.bookId, 'failed');
            }
        }));
        if (disposed || token !== generation)
            return;
        const stillActive = state.batchAnalysisResults.some((item) => (item.disposition === 'accepted'
            && !item.seenStatuses.some((status) => status === 'ready' || status === 'failed' || status === 'stale')));
        if (stillActive) {
            batchAnalysisTimer = scheduler.setTimeout(() => void pollBatchAnalysis(), 600);
        }
        else {
            state.isBatchAnalyzing = false;
        }
    }
    const handleBatchAnalyze = async () => {
        if (state.isBatchAnalyzing || input.selectedBookIds.length === 0)
            return;
        stopBatchAnalysisPolling();
        const token = ++generation;
        state.isBatchAnalyzing = true;
        state.batchAnalysisError = null;
        const titles = new Map(input.books.map((book) => [book.id, book.title]));
        try {
            const response = await api.analyzeBatch({
                bookIds: [...input.selectedBookIds],
                force: false,
            });
            if (disposed || token !== generation)
                return;
            state.batchAnalysisResults = response.items.map((item) => {
                const disposition = item.disposition ?? item.outcome ?? 'rejected';
                return {
                    bookId: item.bookId,
                    title: titles.get(item.bookId) ?? `书籍 #${item.bookId}`,
                    disposition,
                    reason: item.reason ?? item.errorCode ?? null,
                    seenStatuses: disposition === 'rejected' ? ['failed'] : [item.status],
                };
            });
            void pollBatchAnalysis();
        }
        catch (cause) {
            state.isBatchAnalyzing = false;
            state.batchAnalysisError = cause instanceof Error ? cause.message : '批量 AI 预分析提交失败';
        }
    };
    /** 关闭结果面板：只在整批结束后清空；分析中面板就是进度，不能关 */
    function dismissBatchResults() {
        if (state.isBatchAnalyzing)
            return;
        state.batchAnalysisResults = [];
        state.batchAnalysisError = null;
    }
    function dispose() { disposed = true; generation++; stopBatchAnalysisPolling(); }
    return { handleBatchAnalyze, dismissBatchResults, dispose };
}
