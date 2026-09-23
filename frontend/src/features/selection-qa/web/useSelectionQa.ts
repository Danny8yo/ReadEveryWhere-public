import { randomId } from '../../../services/randomId';
import { encodePending, decodePending } from "../domain/pending";
import { reactive, onBeforeUnmount } from "vue";
import { createQaState, createQaController } from "../domain/controller";
import { selectionQaApi } from "../api/selectionQaApi";
import type { LoadedEpubIdentity } from "../model/selectionQa";
export function useSelectionQa(
  bookId: number,
  userId: number,
  host: {
    identity: () => LoadedEpubIdentity | null;
    navigate: (cfi: string) => Promise<void>;
    changed: () => Promise<void>;
  },
) {
  const state = reactive(createQaState());
  const key = `rew.selection-qa.pending.v1.${userId}.${bookId}`;
  const controller = createQaController(state, bookId, selectionQaApi, {
    ...host,
    commandId: () => randomId(),
    later: (fn, ms) => {
      const timer = window.setTimeout(fn, ms);
      return () => window.clearTimeout(timer);
    },
    savePending: (command) => {
      if (command)
        sessionStorage.setItem(key, encodePending(command, userId, bookId));
      else sessionStorage.removeItem(key);
    },
    loadPending: () => {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      return decodePending(raw, userId, bookId);
    },
  });
  onBeforeUnmount(controller.dispose);
  return { state, ...controller };
}
