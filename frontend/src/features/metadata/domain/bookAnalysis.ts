import type { AnalyzeBookOptions, BookAnalysisDetail, BookAnalysisRequestResult } from '../model/bookAnalysis';
import { isBookAnalysisActive } from './analysisState';
import type { Scheduler } from '../../../shared/domain/scheduler';
import { errorMessage } from '../../../shared/domain/errors';
export const createBookAnalysisState = () => ({ analysis: null as BookAnalysisDetail | null, loading: false, analyzing: false, error: null as string | null });
export function createBookAnalysisController(state: ReturnType<typeof createBookAnalysisState>, getBookId: () => number | null, api: {
    getBookAnalysis(id: number): Promise<BookAnalysisDetail>;
    analyzeBook(id: number, input: AnalyzeBookOptions): Promise<BookAnalysisRequestResult>;
}, scheduler: Scheduler, interval = 600) {
    let generation = 0, disposed = false;
    let timer: number | null = null;
    function clear() { if (timer !== null)
        scheduler.clearTimeout(timer); timer = null; }
    function schedule() { clear(); if (!disposed && state.analysis && isBookAnalysisActive(state.analysis.status))
        timer = scheduler.setTimeout(() => void refresh(), interval); }
    async function refresh() {
        const id = getBookId();
        if (id === null) {
            state.analysis = null;
            return null;
        }
        if (id <= 0)
            throw new Error('无效书籍 ID');
        const token = ++generation;
        state.loading = true;
        state.error = null;
        try {
            const result = await api.getBookAnalysis(id);
            if (disposed || token !== generation)
                return null;
            state.analysis = result;
            schedule();
            return result;
        }
        catch (cause) {
            if (!disposed && token === generation)
                state.error = errorMessage(cause);
            return null;
        }
        finally {
            if (token === generation)
                state.loading = false;
        }
    }
    async function analyze(input: AnalyzeBookOptions = {}) {
        const id = getBookId();
        if (id === null || state.analyzing)
            return null;
        if (id <= 0)
            throw new Error('无效书籍 ID');
        clear();
        const token = ++generation;
        state.analyzing = true;
        state.error = null;
        try {
            const result = await api.analyzeBook(id, input.force ? { force: true } : {});
            if (disposed || token !== generation)
                return null;
            state.analysis = { bookId: id, status: result.status === 'running' ? 'running' : 'pending', stale: false, candidate: null, errorCode: null };
            schedule();
            return result;
        }
        catch (cause) {
            if (!disposed && token === generation)
                state.error = errorMessage(cause);
            return null;
        }
        finally {
            if (token === generation)
                state.analyzing = false;
        }
    }
    function reset() { generation++; clear(); state.analysis = null; state.error = null; state.loading = false; state.analyzing = false; }
    function dispose() { disposed = true; reset(); }
    return { refresh, analyze, reset, dispose };
}
