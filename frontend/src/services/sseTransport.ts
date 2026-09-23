import {
  createEventSource,
  type EventSourceClient,
  type EventSourceMessage,
} from "eventsource-client";
import {
  fetchWithAuth,
  getBaseUrl,
  getSessionVersion,
  resolveBackendUrl,
} from "./apiClient";
/** The library owns parsing, reconnect scheduling and abort. This adapter owns identity and foreground liveness. */
export function openCookieSse(
  path: string,
  handlers: {
    message(event: EventSourceMessage): void;
    open?(): void;
    error(error: unknown): void;
  },
) {
  const backend = getBaseUrl(),
    identity = getSessionVersion();
  let disposed = false,
    client: EventSourceClient | undefined,
    lastReceived = Date.now();
  const current = () =>
    !disposed && backend === getBaseUrl() && identity === getSessionVersion();
  const fail = (error: unknown) => {
    if (current()) handlers.error(error);
  };
  let connectionGeneration = 0;
  function connect() {
    const generation = ++connectionGeneration;
    const active = () => current() && generation === connectionGeneration;
    const connectionFailure = (error: unknown) => {
      if (active()) fail(error);
    };
    lastReceived = Date.now();
    client = createEventSource({
      url: resolveBackendUrl(path),
      credentials: "include",
      fetch: async (url, init) => {
        if (!active()) {
          if (!current()) dispose();
          throw new DOMException("会话已变更", "AbortError");
        }
        const response = await fetchWithAuth(String(url), init as RequestInit);
        if (!active()) throw new DOMException("旧连接已结束", "AbortError");
        if (response.status === 401) {
          dispose();
          throw new DOMException("会话已结束", "AbortError");
        }
        if (
          !response.ok ||
          !response.body ||
          !response.headers.get("content-type")?.includes("text/event-stream")
        ) {
          const error = new Error(`实时连接失败 (${response.status})`);
          fail(error);
          if (response.status >= 400 && response.status < 500) dispose();
          throw error;
        }
        return response;
      },
      onConnect: () => {
        if (active()) {
          lastReceived = Date.now();
          handlers.open?.();
        }
      },
      onComment: () => {
        if (active()) lastReceived = Date.now();
      },
      onMessage: (event) => {
        if (active()) {
          lastReceived = Date.now();
          try {
            handlers.message(event);
          } catch (error) {
            fail(error);
            dispose();
          }
        }
      },
      onDisconnect: () =>
        connectionFailure(new Error("实时连接中断，正在重连")),
      onScheduleReconnect: () =>
        connectionFailure(new Error("实时连接中断，正在重连")),
    });
  }
  const watchdog = window.setInterval(() => {
    if (!current()) {
      dispose();
      return;
    }
    if (
      document.visibilityState !== "hidden" &&
      Date.now() - lastReceived >= 45000
    ) {
      fail(new Error("实时连接超时，正在重连"));
      client?.close();
      connect();
    }
  }, 5000);
  const foreground = () => {
    if (
      document.visibilityState !== "hidden" &&
      current() &&
      Date.now() - lastReceived >= 45000
    ) {
      client?.close();
      connect();
    }
  };
  document.addEventListener("visibilitychange", foreground);
  function dispose() {
    if (disposed) return;
    disposed = true;
    client?.close();
    window.clearInterval(watchdog);
    document.removeEventListener("visibilitychange", foreground);
  }
  connect();
  return dispose;
}
