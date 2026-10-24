import { ReaderToolException } from "../../domain/reader-tool-error";
export interface ContentExecution { signal: AbortSignal; deadline: number }
export function checkContentExecution(execution?: ContentExecution): void {
  if (!execution) return;
  if (execution.signal.aborted) throw new ReaderToolException("CONTENT_CANCELLED", "Content operation cancelled");
  if (!Number.isSafeInteger(execution.deadline) || Date.now() >= execution.deadline)
    throw new ReaderToolException("INDEX_DEADLINE", "Content operation deadline exceeded");
}
