import { useLibraryInvalidation, withLibraryInvalidation } from '../../library/web/librarySession';
import { reactive, toRefs, computed, watch, onBeforeUnmount } from 'vue';
import { createBatchReviewState, createBatchReviewController, type BatchReviewEvents } from '../domain/batchReview';
import * as api from '../api/metadataApi';
import { getLibraryBook } from '../../library/api/libraryApi';
import type { LibraryBook } from '../../library/model/library';
import type { MetadataProvider } from '../model/metadata';
/** 作用域：一次批量审核弹窗；候选与版本快照随本次审核销毁。 */
export function useBatchMetadataReview(input: {
    isOpen: boolean;
    books: LibraryBook[];
    provider: MetadataProvider;
}, emit: BatchReviewEvents) {
    const invalidation=useLibraryInvalidation();
    const state = reactive(createBatchReviewState());
    const controller = createBatchReviewController(state, input, { ...api, applyMetadataToBook:withLibraryInvalidation(invalidation,api.applyMetadataToBook), reloadBook: getLibraryBook }, emit);
    watch(() => input.isOpen, open => { if (open)
        void controller.collectCandidates();
    else
        controller.dispose(); }, { immediate: true });
    onBeforeUnmount(controller.dispose);
    return { ...toRefs(state), ...controller, busy: computed(() => controller.derived.busy), activeEntry: computed(() => controller.derived.activeEntry), acceptedCount: computed(() => controller.derived.acceptedCount), reviewCount: computed(() => controller.derived.reviewCount), appliedCount: computed(() => controller.derived.appliedCount), unchangedCount: computed(() => controller.derived.unchangedCount), noCandidateCount: computed(() => controller.derived.noCandidateCount), failedCount: computed(() => controller.derived.failedCount), progressPercent: computed(() => controller.derived.progressPercent), providerLabel: computed(() => controller.derived.providerLabel) };
}
