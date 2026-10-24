import { reactive, toRefs, computed } from 'vue';
import { createAnnotationsState, createAnnotationsController } from '../domain/annotations';
import { createAnnotation, updateAnnotation, deleteAnnotation } from '../api/annotationApi';
/** 作用域：单次开书；批注 revision、冲突和确认后更新由核心管理。 */
export function useAnnotations(bookId: number) {
    const state = reactive(createAnnotationsState());
    const controller = createAnnotationsController(state, { create: params => { if (params.bookId !== bookId)
            throw new Error('批注书籍不匹配'); return createAnnotation(params); }, update: updateAnnotation, delete: deleteAnnotation });
    return { ...toRefs(state), ...controller, annotationsByType: computed(() => controller.derived.annotationsByType), annotationsWithNotes: computed(() => controller.derived.annotationsWithNotes) };
}
