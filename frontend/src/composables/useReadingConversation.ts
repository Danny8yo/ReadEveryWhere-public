import { reactive, toRefs, computed, onMounted, onUnmounted, watch, type Ref } from 'vue';
import { createConversationState, createConversationController, type UseReadingConversationOptions } from '../features/ai-reading/domain/conversation';
import { aiReadingApi } from '../features/ai-reading/api/aiReadingApi';
import { webScheduler } from '../shared/web/scheduler';
/** 作用域：单书面板实例；卸载后停止轮询并隔离迟到响应。 */
export function useReadingConversation(bookId: Ref<number> | number, options: UseReadingConversationOptions = {}) {
    const resolvedBookId = computed(() => typeof bookId === 'number' ? bookId : bookId.value);
    const state = reactive(createConversationState());
    const controller = createConversationController(state, aiReadingApi, webScheduler, () => resolvedBookId.value, options);
    watch(resolvedBookId, () => void controller.changeBook());
    onMounted(() => { void controller.loadBudgetConfig(); void controller.refresh(); });
    onUnmounted(controller.dispose);
    return { ...toRefs(state), ...controller, currentTurnActive: computed(() => controller.derived.currentTurnActive), currentConversationFrozen: computed(() => controller.derived.currentConversationFrozen), canNavigateCitation: computed(() => controller.derived.canNavigateCitation), canSendTurn: computed(() => controller.derived.canSendTurn) };
}
