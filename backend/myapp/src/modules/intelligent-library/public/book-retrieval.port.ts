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
/** Maximum fused candidate pool returned before verification (dual recall + reranking). */
export const BOOK_MAX_POOL = 40;
/** Which recall list found a pool candidate, and at which rank in that list. Diagnostics only. */
export interface BookPoolPath { kind: string; query: string; rank: number }
export interface BookPoolListStat { kind: string; query: string; considered: number; minimum: number; hitCount: number }
/** An index candidate before EPUB replay. Its text is derived index data, not citable evidence. */
export interface BookPoolCandidate {
  sectionIndex: number;
  href: string;
  start: number;
  end: number;
  quote: string;
  quoteHash: string;
  displayedQuote: string;
  cfi: string;
  fusedRank: number;
  paths: BookPoolPath[];
}
export type BookPoolResult =
  | Extract<IndexState, { state: "building" }>
  | (Extract<IndexState, { state: "ready" }> & { candidates: BookPoolCandidate[]; rawCandidateCount: number; lists: BookPoolListStat[] });
export const BOOK_RETRIEVAL_PORT = Symbol("BOOK_RETRIEVAL_PORT");
export interface BookRetrievalPort {
  verifyRanges(userId: number, input: RetrievalScope & {
    ranges: Array<{ sectionIndex: number; href: string; start: number; end: number }>;
    deadline: number; signal: AbortSignal;
  }): Promise<{ candidates: VerifiedBookEvidence[]; unavailable: Array<{ sectionIndex: number; href: string; start: number; end: number; reason: string }> }>;
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
      /** Used only by the dual-v1 pipeline as an extra low-weight word recall list. */
      informationNeed?: string;
      limit?: number;
      maxChars?: number;
      deadline: number;
      signal?: AbortSignal;
    },
  ): Promise<BookRetrievalResult>;
  /** Fused, deduplicated candidate pool without replay; callers verify what they deliver. */
  searchPool(
    userId: number,
    input: RetrievalScope & {
      queries: string[];
      informationNeed?: string;
      poolLimit?: number;
      deadline: number;
      signal?: AbortSignal;
    },
  ): Promise<BookPoolResult>;
  /** Admits candidates in the given order under budgets and proves each by exact EPUB replay. */
  verifyCandidates(
    userId: number,
    input: RetrievalScope & {
      candidates: BookPoolCandidate[];
      limit: number;
      maxChars: number;
      deadline: number;
      signal?: AbortSignal;
    },
  ): Promise<{ candidates: VerifiedBookEvidence[]; admitted: number[]; budgetLimited: boolean }>;
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
