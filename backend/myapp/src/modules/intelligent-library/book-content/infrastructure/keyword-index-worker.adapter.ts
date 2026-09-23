import {
  buildEpubIndex,
  replayEpubRanges,
  readEpubContext,
  expandEpubEvidence,
  CHUNKER_VERSION,
} from "@readeverywhere/epub-core/node";
import {
  prepareKeywordQueries,
  TOKENIZER_VERSION,
  QUERY_POLICY_VERSION,
} from "@readeverywhere/epub-core/keywords";
import type { KeywordIndexWorker } from "../application/ports/keyword-index.port";
import { ReaderToolException } from "../domain/reader-tool-error";
export class KeywordIndexWorkerAdapter implements KeywordIndexWorker {
  readonly version = {
    chunkerVersion: CHUNKER_VERSION,
    tokenizerVersion: TOKENIZER_VERSION,
    queryPolicyVersion: QUERY_POLICY_VERSION,
  };
  queries(input: string[]) {
    try {
      return prepareKeywordQueries(input);
    } catch (error) {
      throw new ReaderToolException(
        "QUERY_INVALID",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  build(...[bytes, onBatch, signal]: Parameters<KeywordIndexWorker["build"]>) {
    return buildEpubIndex(bytes, { onBatch, signal, timeoutMs: 60_000 });
  }
  replay: KeywordIndexWorker["replay"] = (
    bytes,
    scope,
    ranges,
    deadline,
    signal,
  ) =>
    replayEpubRanges(
      bytes,
      { bookId: scope.bookId, ...scope.contentRevision },
      ranges,
      { timeoutMs: this.remaining(deadline), signal },
    );
  candidatesReplay: KeywordIndexWorker["candidatesReplay"] = (bytes, scope, ranges, deadline, signal) => {
    if (!ranges.length || ranges.length > 20)
      throw new ReaderToolException("LOCATOR_INVALID", "Candidate replay accepts 1–20 ranges");
    return this.replay(bytes, scope, ranges, deadline, signal);
  };
  expand: KeywordIndexWorker["expand"] = (
    bytes, scope, ranges, options, deadline, signal,
  ) => expandEpubEvidence(
    bytes,
    { bookId: scope.bookId, ...scope.contentRevision },
    ranges,
    { ...options, timeoutMs: this.remaining(deadline), signal },
  );
  context: KeywordIndexWorker["context"] = async (
    bytes,
    scope,
    range,
    maxChars,
    deadline,
    signal,
  ) => {
    const rows = await readEpubContext(
      bytes,
      { bookId: scope.bookId, ...scope.contentRevision },
      range,
      maxChars,
      { timeoutMs: this.remaining(deadline), signal },
    );
    if (rows.length !== 1)
      throw new Error("Context worker returned wrong range count");
    return rows[0];
  };
  private remaining(deadline: number) {
    const remaining = deadline - Date.now();
    if (!Number.isSafeInteger(deadline) || remaining <= 0)
      throw new ReaderToolException(
        "INDEX_DEADLINE",
        "Content operation deadline exceeded",
      );
    return remaining;
  }
}
