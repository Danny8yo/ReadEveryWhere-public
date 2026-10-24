import type {
  EpubIndexChunk,
  IndexBuildResult,
  EpubEvidence,
  ExpandedEpubEvidence,
  ReplayInput,
} from "@readeverywhere/epub-core/node";
import type { DualRecallList } from "@readeverywhere/epub-core/keywords";
import type {
  IndexVersion,
  RetrievalScope,
} from "../../../public/book-retrieval.port";
/** Per-generation FTS file layout; part of the generation record, checked on every read. */
export type IndexFormat = "unigram-file-v1" | "dual-file-v1";
export interface IndexIdentity extends RetrievalScope {
  userId: number;
  key: string;
  version: IndexVersion;
  format: IndexFormat;
}
export interface IndexGeneration {
  id: string;
  state: "queued" | "building" | "ready" | "failed";
  error: string | null;
  unavailable: IndexBuildResult["unavailable"];
}
export interface RankedChunk extends ReplayInput {
  id: number;
  quote: string;
  displayedQuote: string;
  tokens: string;
  score: number;
}
export interface KeywordIndexRepository {
  recoverInterrupted(): void;
  current(identity: IndexIdentity): IndexGeneration | null;
  latest(identity: IndexIdentity): IndexGeneration | null;
  begin(
    identity: IndexIdentity,
    owner: string,
    rebuild?: boolean,
  ): { generation: IndexGeneration; created: boolean };
  append(
    identity: IndexIdentity,
    id: string,
    owner: string,
    chunks: EpubIndexChunk[],
  ): void;
  publish(
    identity: IndexIdentity,
    id: string,
    owner: string,
    result: IndexBuildResult,
  ): void;
  fail(id: string, owner: string, error: string): void;
  search(
    identity: IndexIdentity,
    id: string,
    queryTokens: string[],
  ): RankedChunk[];
  /** dual-file-v1 only: every list is evaluated against the same verified file. */
  searchLists(
    identity: IndexIdentity,
    id: string,
    lists: DualRecallList[],
    limit: number,
  ): Array<{ list: DualRecallList; considered: number; minimum: number; hits: RankedChunk[] }>;
}
export interface KeywordIndexWorker {
  ranges(bytes: Buffer, scope: RetrievalScope, ranges: Array<Pick<ReplayInput, "sectionIndex" | "href" | "start" | "end">>, deadline: number, signal: AbortSignal): Promise<{ candidates: EpubEvidence[]; unavailable: Array<Pick<ReplayInput, "sectionIndex" | "href" | "start" | "end"> & { reason: string }> }>;

  readonly version: IndexVersion;
  readonly format: IndexFormat;
  queries(input: string[]): string[][];
  plan(queries: string[], informationNeed?: string): { version: string; lists: DualRecallList[] };
  build(
    bytes: Buffer,
    onBatch: (chunks: EpubIndexChunk[]) => Promise<void>,
    signal: AbortSignal,
  ): Promise<IndexBuildResult>;
  replay(
    bytes: Buffer,
    scope: RetrievalScope,
    ranges: ReplayInput[],
    deadline: number,
    signal?: AbortSignal,
  ): Promise<EpubEvidence[]>;
  candidatesReplay(
    bytes: Buffer,
    scope: RetrievalScope,
    ranges: ReplayInput[],
    deadline: number,
    signal?: AbortSignal,
  ): Promise<EpubEvidence[]>;
  expand(
    bytes: Buffer,
    scope: RetrievalScope,
    ranges: ReplayInput[],
    options: { maxChars: number; maxWindowChars: number; limit: number; preserveAllHits?: boolean },
    deadline: number,
    signal?: AbortSignal,
  ): Promise<ExpandedEpubEvidence[]>;
  context(
    bytes: Buffer,
    scope: RetrievalScope,
    range: Pick<ReplayInput, "sectionIndex" | "href" | "start" | "end">,
    maxChars: number,
    deadline: number,
    signal?: AbortSignal,
  ): Promise<EpubEvidence>;
}
