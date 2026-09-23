import type {
  ContentScope,
  SelectionRequest,
  ResolvedSelection,
} from "./types.js";
export interface EpubHeading {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  label: string;
  start: number;
}
export interface EpubSection {
  sectionIndex: number;
  href: string;
  text: string;
  charCount: number;
  anchors: Record<string, number>;
  headings: EpubHeading[];
  fragmentHeadingIndexes: Record<string, number>;
  title: string;
}
export interface EpubTocNode {
  label: string;
  href: string | null;
  children: EpubTocNode[];
}
export interface ParsedEpub {
  sections: EpubSection[];
  toc: EpubTocNode[];
  tocSource: "ncx" | "epub_nav" | null;
}
export interface WorkerOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}
export interface CfiSelectionRequest {
  scope: ContentScope;
  cfi: string;
  displayedQuote: string;
  source?: never;
}
export function parseEpub(
  bytes: Uint8Array,
  options?: WorkerOptions,
): Promise<ParsedEpub>;
/** expectedScope must be obtained from an authorized current artifact; the worker validates bytes/revision/resource and exact quote, not user ownership. */
export function resolveEpubSelection(
  bytes: Uint8Array,
  expectedScope: ContentScope,
  request: SelectionRequest | CfiSelectionRequest,
  options?: WorkerOptions,
): Promise<ResolvedSelection>;
export interface EpubIndexChunk {
  /** Forced split of an oversized sentence, code line, or table row. */
  boundaryTruncated?: boolean;
  ordinal: number;
  sectionIndex: number;
  href: string;
  start: number;
  end: number;
  quote: string;
  quoteHash: string;
  displayedQuote: string;
  cfi: string;
  source: import("./types.js").SourceRange;
  tokens: string;
}
export interface IndexBuildResult {
  chunkCount: number;
  chunkerVersion: string;
  tokenizerVersion: string;
  unavailable: Array<{
    sectionIndex: number;
    href: string;
    start: number;
    end: number;
    reason: string;
  }>;
}
export interface EpubRevisionScope {
  bookId: number;
  fileChecksum: string;
  extractorVersion: string;
  normalizationVersion: string;
}
export type ReplayInput = Pick<
  EpubIndexChunk,
  "sectionIndex" | "href" | "start" | "end" | "quoteHash" | "cfi"
>;
export type EpubEvidence = Omit<EpubIndexChunk, "ordinal" | "tokens"> & {
  /** Context reads disclose incomplete sentence/structure endpoints; absent on plain replay. */
  contextTruncated?: boolean;
};
export function buildEpubIndex(
  bytes: Uint8Array,
  options: WorkerOptions & {
    onBatch: (chunks: EpubIndexChunk[]) => void | Promise<void>;
  },
): Promise<IndexBuildResult>;
export function replayEpubRanges(
  bytes: Uint8Array,
  scope: EpubRevisionScope,
  ranges: ReplayInput[],
  options?: WorkerOptions,
): Promise<EpubEvidence[]>;
export function readEpubContext(
  bytes: Uint8Array,
  scope: EpubRevisionScope,
  range: Pick<ReplayInput, "sectionIndex" | "href" | "start" | "end">,
  maxChars: number,
  options?: WorkerOptions,
): Promise<EpubEvidence[]>;

export const CHUNKER_VERSION: string;

/** Real contiguous source window. hitRanges retain retrieval provenance only. */
export interface ExpandedEpubEvidence extends EpubEvidence {
  hitRanges: Array<{ sectionIndex: number; start: number; end: number }>;
  /** At least one boundary could not be completed to a structural/sentence unit. */
  contextTruncated: boolean;
}
export function expandEpubEvidence(
  bytes: Uint8Array, scope: EpubRevisionScope,
  ranges: Array<ReplayInput & { quote?: string; displayedQuote?: string }>,
  options: WorkerOptions & { maxChars: number; maxWindowChars: number; limit: number;
    /** Preserve every selected hit; requires ranges.length <= limit and reserves all full hit lengths before expansion. */
    preserveAllHits?: boolean },
): Promise<ExpandedEpubEvidence[]>;
