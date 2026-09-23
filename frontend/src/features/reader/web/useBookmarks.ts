import { reactive, toRefs, onBeforeUnmount } from 'vue';
import { createBookmark, deleteBookmark } from '../api/bookmarkApi';
import { createBookmarkState, createBookmarkController } from '../domain/bookmarkCommands';
export function useBookmarks() { const state = reactive(createBookmarkState()); const controller = createBookmarkController(state, { create: createBookmark, delete: deleteBookmark }); onBeforeUnmount(controller.dispose); return { ...toRefs(state), ...controller }; }
