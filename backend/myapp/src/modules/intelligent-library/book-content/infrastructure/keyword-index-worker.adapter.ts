import {
  buildEpubIndex,
  readEpubRanges,
  replayEpubRanges,
  readEpubContext,
  expandEpubEvidence,
  CHUNKER_VERSION,
} from "@readeverywhere/epub-core/node";
import {
  prepareKeywordQueries,
  planDualQueries,
  prepareWordSegmenter,
  TOKENIZER_VERSION,
  QUERY_POLICY_VERSION,
  DUAL_TOKENIZER_VERSION,
  DUAL_QUERY_POLICY_VERSION,
} from "@readeverywhere/epub-core/keywords";
import type { IndexFormat, KeywordIndexWorker } from "../application/ports/keyword-index.port";
import type { IndexVersion } from "../../public/book-retrieval.port";
import { ReaderToolException } from "../domain/reader-tool-error";
/** unigram-v4 is the published v4 pipeline; dual-v1 adds jieba word and bigram recall. */
export type ContentIndexPipeline = "unigram-v4" | "dual-v1";
export function contentIndexPipeline(value: string | undefined): ContentIndexPipeline {
  // An empty value (e.g. `CONTENT_INDEX_PIPELINE=` in an env file) means the default, like other settings.
  const pipeline = value || "unigram-v4";
  if (pipeline !== "unigram-v4" && pipeline !== "dual-v1")
    throw new Error(`CONTENT_INDEX_PIPELINE must be unigram-v4 or dual-v1, got ${pipeline}`);
  return pipeline;
}
export class KeywordIndexWorkerAdapter implements KeywordIndexWorker {
  readonly version: IndexVersion;
  readonly format: IndexFormat;
  constructor(private readonly pipeline: ContentIndexPipeline = "unigram-v4") {
    const dual = pipeline === "dual-v1";
    this.format = dual ? "dual-file-v1" : "unigram-file-v1";
    // Query planning runs on the main thread; load the dictionary at startup, not inside the first search.
    if (dual) prepareWordSegmenter();
    this.version = {
      chunkerVersion: CHUNKER_VERSION,
      tokenizerVersion: dual ? DUAL_TOKENIZER_VERSION : TOKENIZER_VERSION,
      queryPolicyVersion: dual ? DUAL_QUERY_POLICY_VERSION : QUERY_POLICY_VERSION,
    };
  }
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
  plan(queries: string[], informationNeed?: string) {
    if (this.pipeline !== "dual-v1") throw new Error("Dual query planning requires the dual-v1 pipeline");
    try {
      return planDualQueries(queries, informationNeed);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("QUERY_INVALID"))
        throw new ReaderToolException("QUERY_INVALID", error.message);
      throw error;
    }
  }
  build(...[bytes, onBatch, signal]: Parameters<KeywordIndexWorker["build"]>) {
    return buildEpubIndex(bytes, { onBatch, signal, timeoutMs: 60_000, streams: this.pipeline === "dual-v1" ? "dual" : "char" });
  }
  ranges: KeywordIndexWorker["ranges"] = (bytes, scope, ranges, deadline, signal) => readEpubRanges(bytes,
    { bookId: scope.bookId, ...scope.contentRevision }, ranges, { timeoutMs: this.remaining(deadline), signal });
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
