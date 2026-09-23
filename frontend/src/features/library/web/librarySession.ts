import {
  inject,
  provide,
  shallowRef,
  reactive,
  watch,
  onScopeDispose,
  type Ref,
  type InjectionKey,
} from "vue";
import {
  createLibraryQueryCache,
  type LibraryInvalidationPort,
} from "../domain/queryCache";
import { fetchLibraryBooks } from "../api/libraryApi";
import { getLibrarySyncState, openLibraryStream } from "../api/librarySyncApi";
import { getBaseUrl, getSessionVersion } from "../../../services/apiClient";
import type { LoadLibraryParams } from "../domain/library";
export function createLibrarySession(
  userId: number,
  verify: () => Promise<boolean>,
) {
  let disposed = false,
    ready = false,
    streamHealthy = false,
    recovering: Promise<void> | null = null,
    recoveryAgain = false;
  const backend = getBaseUrl(),
    authGeneration = getSessionVersion();
  const live = () =>
    !disposed &&
    backend === getBaseUrl() &&
    authGeneration === getSessionVersion();
  const status = reactive({
    connection: "connecting",
    error: null as string | null,
  });
  const cache = createLibraryQueryCache(
    async (q) => {
      const data = await fetchLibraryBooks(q);
      if (!live() || data.items.some((book) => book.userId !== userId))
        throw new Error("登录身份已变化，请重新确认登录");
      return data;
    },
    {
      now: Date.now,
      schedule(fn, ms) {
        const id = window.setTimeout(fn, ms);
        return () => window.clearTimeout(id);
      },
    },
  );
  const browse = {
    query: { page: 1, pageSize: 20 } as LoadLibraryParams,
    scrollY: 0,
  };
  async function recover(checkIdentity = true) {
    if (!live() || !ready || document.visibilityState === "hidden") return;
    if (recovering) return recovering;
    cache.setPaused(true);
    recovering = (async () => {
      try {
        if (checkIdentity && !(await verify())) return;
        if (!live()) return;
        const version = await getLibrarySyncState();
        if (!live()) return;
        cache.observeVersion(version);
        cache.invalidateDownloadSnapshots();
        cache.setPaused(false);
        cache.revalidate();
        if (streamHealthy) {
          status.error = null;
          status.connection = "connected";
        }
      } catch (error) {
        if (live()) {
          status.error = error instanceof Error ? error.message : String(error);
          status.connection = "reconnecting";
        }
      } finally {
        recovering = null;
        if (recoveryAgain) {
          recoveryAgain = false;
          void recover(false);
        }
      }
    })();
    return recovering;
  }
  const stop = openLibraryStream({
    ready(version) {
      if (!live()) return;
      ready = true;
      streamHealthy = true;
      if (recovering) recoveryAgain = true;
      cache.observeVersion(version);
      void recover();
    },
    change(version) {
      if (live()) cache.observeVersion(version);
    },
    progress(event) {
      if (live()) cache.applyProgress(event);
    },
    error(error) {
      if (live()) {
        streamHealthy = false;
        status.connection = "reconnecting";
        status.error = error instanceof Error ? error.message : String(error);
      }
    },
  });
  const resume = () => {
    void recover();
  };
  const visibility = () => {
    if (document.visibilityState !== "hidden") resume();
  };
  window.addEventListener("focus", resume);
  window.addEventListener("online", resume);
  document.addEventListener("visibilitychange", visibility);
  return {
    cache,
    browse,
    status,
    recover,
    dispose() {
      disposed = true;
      stop();
      cache.dispose();
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", visibility);
    },
  };
}
export type LibrarySession = ReturnType<typeof createLibrarySession>;
const sessionKey: InjectionKey<Ref<LibrarySession | null>> =
  Symbol("library-session");
export function provideLibrarySession(
  identity: Ref<string>,
  ready: Ref<boolean>,
  getUserId: () => number,
  verify: () => Promise<boolean>,
) {
  const session = shallowRef<LibrarySession | null>(null);
  watch(
    [identity, ready],
    () => {
      session.value?.dispose();
      session.value = ready.value
        ? createLibrarySession(getUserId(), verify)
        : null;
    },
    { immediate: true, flush: "sync" },
  );
  provide(sessionKey, session);
  onScopeDispose(() => session.value?.dispose());
}
export function useLibrarySession() {
  const ref = inject(sessionKey);
  if (!ref?.value) throw new Error("缺少已验证的书架会话");
  return ref.value;
}
export function useLibraryInvalidation(): LibraryInvalidationPort {
  const session = useLibrarySession();
  return { invalidate: () => session.cache.invalidate() };
}
export function withLibraryInvalidation<T extends unknown[], R>(
  port: LibraryInvalidationPort,
  command: (...args: T) => Promise<R>,
) {
  return async (...args: T): Promise<R> => {
    try {
      return await command(...args);
    } finally {
      port.invalidate();
    }
  };
}
