import { useLibrarySession, useLibraryInvalidation, withLibraryInvalidation } from './librarySession';
import { reactive, toRefs, onBeforeUnmount, type Ref } from 'vue';
import type { LibraryBook } from '../model/library';
import { createBatchAnalysisController, createBatchAnalysisState } from '../domain/batchAnalysis';
import { bookAnalysisApi } from '../../metadata/api/bookAnalysisApi';
import { toAnalysisSummary } from '../../metadata/domain/analysisSummary';
import { webScheduler } from '../../../shared/web/scheduler';
/** 作用域：书架实例中的一批分析任务。 */
export function useLibraryAnalysis(books: Ref<LibraryBook[]>, selected: Ref<number[]>) {
    const session=useLibrarySession();
    const invalidation=useLibraryInvalidation();
    const state = reactive(createBatchAnalysisState());
    const controller = createBatchAnalysisController(state, { get books() { return books.value; }, get selectedBookIds() { return selected.value; }, updateAnalysis(detail) { session.cache.updateBook(detail.bookId,{bookAnalysis:toAnalysisSummary(detail)}); } }, {...bookAnalysisApi,analyzeBatch:withLibraryInvalidation(invalidation,bookAnalysisApi.analyzeBatch)}, webScheduler);
    onBeforeUnmount(controller.dispose);
    return { ...toRefs(state), ...controller };
}
