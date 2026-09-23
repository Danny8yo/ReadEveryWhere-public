import {
  request,
  fetchWithAuth,
  resolveBackendUrl,
} from "../../../services/apiClient";
import { listAnnotations } from "../../reader/api/annotationApi";
import type { QaApi, QaEvent } from "../model/selectionQa";
const base = "/api/v1/selection-qa";
const id = encodeURIComponent;
export const selectionQaApi: QaApi = {
  conversations: (bookId, cursor) =>
    request(`${base}/conversations`, {
      params: { bookId, limit: 20, ...(cursor ? { cursor } : {}) },
    }),
  conversation: (conversationId) =>
    request(`${base}/conversations/${id(conversationId)}`),
  turns: (conversationId, cursor = 0) =>
    request(`${base}/conversations/${id(conversationId)}/turns`, {
      params: { cursor, limit: 100 },
    }),
  execute: (command) =>
    request(
      command.kind === "create"
        ? `${base}/conversations`
        : command.kind === "turn"
          ? `${base}/conversations/${id(command.conversationId)}/turns`
          : `${base}/turns/${id(command.turnId)}/apply-annotation`,
      { method: "POST", body: JSON.stringify(command.body) },
    ),
  receipt: (commandId) =>
    request(`/api/v1/annotations/commands/${id(commandId)}`),
  stop: (turnId) =>
    request(`${base}/turns/${id(turnId)}/stop`, { method: "POST" }),
  delete: (conversationId) =>
    request(`${base}/conversations/${id(conversationId)}`, {
      method: "DELETE",
    }),
  location: (conversationId, turnId, evidenceId) =>
    request(
      turnId && evidenceId
        ? `${base}/turns/${id(turnId)}/evidence/${id(evidenceId)}/location`
        : `${base}/conversations/${id(conversationId)}/location`,
    ),
  annotations: listAnnotations,
  subscribe: (turnId, after, handlers) => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetchWithAuth(
          resolveBackendUrl(
            `${base}/turns/${id(turnId)}/events?afterSequence=${after}`,
          ),
          {
            headers: { Accept: "text/event-stream" },
            signal: controller.signal,
          },
        );
        if (!response.ok || !response.body)
          throw new Error(`问答连接失败 (${response.status})`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        try {
          while (!controller.signal.aborted) {
            const { done, value } = await reader.read();
            buffer += decoder.decode(value, { stream: !done });
            let match: RegExpExecArray | null;
            while ((match = /\r?\n\r?\n/.exec(buffer))) {
              const frame = buffer.slice(0, match.index);
              buffer = buffer.slice(match.index + match[0].length);
              const data = frame
                .split(/\r?\n/)
                .filter((line) => line.startsWith("data:"))
                .map((line) => line.slice(5).trimStart())
                .join("\n");
              if (data && !controller.signal.aborted)
                handlers.event(JSON.parse(data) as QaEvent);
            }
            if (buffer.length > 200000) throw new Error("问答流事件过大。");
            if (done) break;
          }
        } finally {
          try {
            await reader.cancel();
          } finally {
            reader.releaseLock();
          }
        }
        if (!controller.signal.aborted) handlers.end();
      } catch (error) {
        if (!controller.signal.aborted) handlers.error(error);
      }
    })();
    return () => controller.abort();
  },
};
