import { request } from "../../../services/apiClient";
import { openCookieSse } from "../../../services/sseTransport";
import type { LibraryVersion, DownloadProgressEvent } from "../model/sync";
export function libraryVersion(value: unknown): LibraryVersion {
  if (
    !value ||
    typeof value !== "object" ||
    !("epoch" in value) ||
    typeof value.epoch !== "string" ||
    !value.epoch ||
    !("revision" in value) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0
  )
    throw new Error("书库同步接口不兼容，请刷新页面并确认服务器版本");
  return value as LibraryVersion;
}
export async function getLibrarySyncState() {
  const data = await request<{ libraryVersion: unknown }>(
    "/api/v1/library/sync-state",
  );
  return libraryVersion(data.libraryVersion);
}
export function openLibraryStream(handlers: {
  ready(version: LibraryVersion): void;
  change(version: LibraryVersion): void;
  progress(event: DownloadProgressEvent): void;
  error(error: unknown): void;
}) {
  return openCookieSse("/api/v1/library/stream", {
    error: handlers.error,
    message(event) {
      if (event.event === "heartbeat") return;
      const data = JSON.parse(event.data);
      if (event.event === "ready")
        handlers.ready(libraryVersion(data.libraryVersion));
      else if (event.event === "library_changed")
        handlers.change(libraryVersion(data.libraryVersion));
      else if (event.event === "download_progress") {
        if (
          typeof data.epoch !== "string" ||
          !["sequence", "bookId", "taskId", "progress"].every((k) =>
            Number.isSafeInteger(data[k]),
          ) ||
          data.sequence < 0 ||
          data.bookId < 1 ||
          data.taskId < 1 ||
          data.progress < 0 ||
          data.progress > 100
        )
          throw new Error("无效下载进度事件");
        handlers.progress(data);
      }
    },
  });
}
