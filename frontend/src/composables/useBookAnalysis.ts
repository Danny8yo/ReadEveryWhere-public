import { useLibraryInvalidation, withLibraryInvalidation } from '../features/library/web/librarySession';
import { reactive, toRefs, computed, watch, onMounted, onUnmounted, type Ref } from 'vue';
import { createBookAnalysisState, createBookAnalysisController } from '../features/metadata/domain/bookAnalysis';
import { bookAnalysisApi } from '../features/metadata/api/bookAnalysisApi';
import { webScheduler } from '../shared/web/scheduler';
/** 作用域：单书详情实例；切书和卸载使旧请求失效。 */
export function useBookAnalysis(bookId: number | null | Ref<number | null>, options: {
    immediate?: boolean;
    pollIntervalMs?: number;
} = {}) {
    const invalidation=useLibraryInvalidation();
    const id = computed(() => typeof bookId === 'object' && bookId !== null ? bookId.value : bookId);
    const state = reactive(createBookAnalysisState());
    const controller = createBookAnalysisController(state, () => id.value, {...bookAnalysisApi,analyzeBook:withLibraryInvalidation(invalidation,bookAnalysisApi.analyzeBook)}, webScheduler, options.pollIntervalMs);
    watch(id, () => { controller.reset(); if (options.immediate !== false)
        void controller.refresh(); });
    onMounted(() => { if (options.immediate !== false)
        void controller.refresh(); });
    onUnmounted(controller.dispose);
    return { ...toRefs(state), refresh: controller.refresh, analyze: controller.analyze };
}
