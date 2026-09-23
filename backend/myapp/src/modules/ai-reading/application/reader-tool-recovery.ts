import type { ReaderToolErrorCode } from "./ports/reading-tools.port";

export interface RecoverableReaderToolError {
  errorCode: ReaderToolErrorCode;
  retryable: true;
  suggestedAction: string;
}

const RECOVERY_ACTIONS: Partial<Record<ReaderToolErrorCode, string>> = {
  TOC_TREE_TOO_LARGE: "Use book_toc to page through the flat outline, then read one selected node with book_read_from_toc.",
  CURSOR_INVALID: "Restart the paginated tool. For book_read_from_toc, supply current nodeIds without cursor; otherwise omit cursor. Reuse returned cursors unchanged.",
  TOC_NODE_NOT_FOUND: "Refresh the outline with book_toc and use node IDs from the current content revision.",
  TOC_NODE_NOT_READABLE: "Choose a readable child or adjacent node from the current book_toc result.",
  TOC_NODE_TOO_LARGE: "Report that this unit cannot be read completely using the existing TOC structure. Do not recover through book_read or summary delegation.",
  LOCATOR_INVALID: "Use book_read_from_toc for a selected TOC node, or obtain a fresh locator from book_search_text before reading again.",
  LOCATOR_OUT_OF_RANGE: "Obtain a fresh locator and reduce or correct the requested reading window.",
  READING_TARGET_ALREADY_REACHED: "Use the current evidence, follow an available continuation in another direction, or choose a new target range.",
  TEXT_QUOTE_MISMATCH: "Refresh the locator from the current book revision before reading again.",
  TOC_REQUEST_INVALID: "Correct the tool arguments using the registered JSON Schema and retry once.",
  QUERY_INVALID: "Correct the query using the registered JSON Schema and retry once.",
};

export function recoverableReaderToolError(error: unknown): RecoverableReaderToolError | null {
  if (!error || typeof error !== "object") return null;
  const details = (error as { details?: unknown }).details;
  if (!details || typeof details !== "object") return null;
  const reason = (details as { reason?: unknown }).reason as ReaderToolErrorCode | undefined;
  const suggestedAction = reason ? RECOVERY_ACTIONS[reason] : undefined;
  if (!reason || !suggestedAction) return null;
  return {
    errorCode: reason,
    retryable: true,
    suggestedAction,
  };
}

export function serializeUntrustedToolOutput(value: unknown): string {
  const json = JSON.stringify(value).replace(/</g, "\\u003c");
  return `<untrusted_tool_output>${json}</untrusted_tool_output>`;
}
