import type {
  ContentRevision,
  EpubBookLocatorV1,
} from "../book-content/domain/book-document.types";
import type { CurrentBookArtifactIdentity } from "./current-book-artifact-fence.port";
export interface RetrievalScope {
  bookId: number;
  artifact: CurrentBookArtifactIdentity;
  contentRevision: ContentRevision;
}
export interface VerifiedBookEvidence {
  contextTruncated?: boolean;
  locator: EpubBookLocatorV1;
  quote: string;
  quoteHash: string;
  displayedQuote: string;
  sectionIndex: number;
  href: string;
  start: number;
  end: number;
  cfi: string;
}
export interface IndexVersion {
  chunkerVersion: string;
  tokenizerVersion: string;
  queryPolicyVersion: string;
}
export type IndexState =
  | { state: "building"; generation: string }
  | {
      state: "ready";
      generation: string;
      version: IndexVersion;
      unavailable: Array<{
        sectionIndex: number;
        href: string;
        start: number;
        end: number;
        reason: string;
      }>;
    };
export interface EvidenceContextWindow {
  sectionIndex: number;
  start: number;
  end: number;
  hitRanges: Array<{ sectionIndex: number; start: number; end: number }>;
  contextTruncated: boolean;
}
export interface ExpandedBookEvidenceResult {
  candidates: VerifiedBookEvidence[];
  contextWindows: EvidenceContextWindow[];
  contextTruncated: boolean;
}
export type ReadyBookRetrievalResult = Extract<IndexState, { state: "ready" }> & ExpandedBookEvidenceResult & {
  rawCandidateCount: number;
  budgetLimited: boolean;
};
export type BookRetrievalResult = ReadyBookRetrievalResult | Extract<IndexState, { state: "building" }>;
/** Maximum number of verified candidate ranges expandable under one shared character budget. */
export const BOOK_MAX_EXPAND_SELECTED = 12;
export const BOOK_MAX_EXPAND_CHARS = 10_000;
export const BOOK_RETRIEVAL_PORT = Symbol("BOOK_RETRIEVAL_PORT");
export interface BookRetrievalPort {
  ensureIndex(
    userId: number,
    scope: RetrievalScope,
    options?: { rebuild?: boolean; retryFailed?: boolean },
  ): Promise<IndexState>;
  retrieve(
    userId: number,
    input: RetrievalScope & {
      queries: string[];
      limit?: number;
      maxChars?: number;
      deadline: number;
      signal?: AbortSignal;
    },
  ): Promise<BookRetrievalResult>;
  searchCandidates(
    userId: number,
    input: RetrievalScope & {
      queries: string[];
      limit?: number;
      maxChars?: number;
      deadline: number;
      signal?: AbortSignal;
    },
  ): Promise<BookRetrievalResult>;
  expandSelected(
    userId: number,
    input: RetrievalScope & {
      evidence: VerifiedBookEvidence[];
      maxChars: number;
      maxWindowChars?: number;
      deadline: number;
      signal?: AbortSignal;
    },
  ): Promise<ExpandedBookEvidenceResult>;
  readContext(
    userId: number,
    input: RetrievalScope & {
      sectionIndex: number;
      href: string;
      start: number;
      end: number;
      maxChars?: number;
      deadline: number;
      signal?: AbortSignal;
    },
  ): Promise<VerifiedBookEvidence>;
  replay(
    userId: number,
    input: RetrievalScope & {
      evidence: VerifiedBookEvidence[];
      deadline: number;
      signal?: AbortSignal;
    },
  ): Promise<VerifiedBookEvidence[]>;
}
