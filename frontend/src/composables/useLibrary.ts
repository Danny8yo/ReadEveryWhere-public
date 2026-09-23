import { reactive, toRefs, onScopeDispose, getCurrentScope } from "vue";
import {
  createLibraryState,
  createLibraryController,
} from "../features/library/domain/library";
import * as api from "../features/library/api/libraryApi";
import { clearBookFileCacheForBook } from "../services/bookFileCache";
import { useLibrarySession } from "../features/library/web/librarySession";
import type { ViewMode } from "../types/library";
/** 页面只持有临时选择；查询数据与浏览上下文属于已验证的应用会话。 */
export function useLibrary() {
  const session = useLibrarySession();
  const state = reactive(createLibraryState());
  state.activeQuery = { ...session.browse.query };
  const cache = session.cache;
  const stop = cache.subscribe((data, cause) => {
    if (data) {
      if (data.page > Math.max(1, Math.ceil(data.total / data.pageSize))) {
        if (state.loading) return;
        void controller
          .loadLibrary(
            { page: Math.max(1, Math.ceil(data.total / data.pageSize)) },
            { silent: true, preserveSelection: true },
          )
          .catch(() => undefined);
        return;
      }
      state.books = data.items;
      state.pagination = {
        page: data.page,
        pageSize: data.pageSize,
        total: data.total,
        totalPages: Math.max(1, Math.ceil(data.total / data.pageSize)),
      };
    }
    state.error = cause
      ? `列表更新失败，当前显示缓存：${cause instanceof Error ? cause.message : String(cause)}`
      : null;
  });
  const foreground = () => {
    cache.setVisible(document.visibilityState !== "hidden");
  };
  document.addEventListener("visibilitychange", foreground);

  foreground();
  const stored = localStorage.getItem("readEveryWhere.viewMode");
  if (stored === "grid" || stored === "list") state.viewMode = stored;
  const controller = createLibraryController(state, {
    ...api,
    fetchLibraryBooks: (q) => {
      session.browse.query = q;
      cache.activate(q);
      return cache.read(q);
    },
    peek: cache.peek,
    invalidate: cache.invalidate,
    clearBookFileCacheForBook,
    saveViewMode: (mode: ViewMode) =>
      localStorage.setItem("readEveryWhere.viewMode", mode),
  });
  if (getCurrentScope())
    onScopeDispose(() => {
      controller.dispose();
      stop();
      cache.setVisible(false);
      document.removeEventListener("visibilitychange", foreground);
      window.removeEventListener("focus", foreground);
      window.removeEventListener("online", foreground);
    });
  // 页面刷新失败由 state.error 呈现；写命令仍向调用者传播失败。
  const loadLibrary: typeof controller.loadLibrary = async (...args) => {
    try {
      if (args[1]?.force) {
        void session.recover();
        cache.invalidate();
      }
      await controller.loadLibrary(...args);
    } catch {
      /* 核心已记录可见错误 */
    }
  };
  return {
    ...toRefs(state),
    ...controller,
    loadLibrary,
    browse: session.browse,
    syncStatus: session.status,
    invalidate: cache.invalidate,
    updateCachedBook: cache.updateBook,
  };
}
