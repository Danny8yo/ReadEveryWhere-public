import { reactive, toRefs, onBeforeUnmount } from 'vue';
import { createCommandState, createCommandController } from '../domain/command';
export function useCommand() { const state = reactive(createCommandState()); const controller = createCommandController(state); onBeforeUnmount(controller.dispose); return { ...toRefs(state), ...controller }; }
