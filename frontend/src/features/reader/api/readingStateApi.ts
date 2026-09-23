import { openCookieSse } from "../../../services/sseTransport";
import type {
  ReadingStateSnapshot,
  ReadingStateChangedEvent,
  ReadingStateStreamHandlers,
} from "../model/readingState";
import { fetchWithAuth, resolveBackendUrl } from "../../../services/apiClient";
export async function getReadingState(
  bookId: number,
): Promise<ReadingStateSnapshot> {
  const response = await fetchWithAuth(
    resolveBackendUrl(`/api/v1/reading-state?bookId=${bookId}`),
  );
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) throw payload;
  return payload.data as ReadingStateSnapshot;
}
export function openReadingStateStream(
  bookId: number,
  handlers: ReadingStateStreamHandlers,
  deviceId?: string,
): () => void {
  const query = new URLSearchParams({ bookId: String(bookId) });
  if (deviceId) query.set("deviceId", deviceId);
  return openCookieSse(`/api/v1/reading-state/stream?${query}`, {
    error: (error) => handlers.onError?.(error),
    message: (event) => {
      if (event.event === "ready") {
        void Promise.resolve(handlers.onOpen?.()).catch((error) =>
          handlers.onError?.(error),
        );
        return;
      }
      if (event.event === "reading_state_changed") {
        const data = JSON.parse(event.data) as ReadingStateChangedEvent;
        if (
          data.bookId !== bookId ||
          !Number.isSafeInteger(data.revision) ||
          !Array.isArray(data.changed)
        )
          throw new Error("无效阅读状态事件");
        void Promise.resolve(handlers.onChange(data)).catch((error) =>
          handlers.onError?.(error),
        );
      }
    },
  });
}
