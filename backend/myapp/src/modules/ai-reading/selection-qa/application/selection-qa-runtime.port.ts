import type {
  Conversation,
  SelectionSnapshot,
  Turn,
} from "./selection-qa.types";
export const SELECTION_QA_MODEL_PORT = Symbol("SELECTION_QA_MODEL_PORT");
export { QA_POLICY } from "../domain/qa-policy";
export interface QaModelSnapshot {
  version: 1;
  providerId: string;
  modelId: string;
  configUpdatedAt: string | null;
  tokenizerId: string;
  contextWindowTokens: number;
  maxOutputTokens: number;
  policyVersion: string;
}
export interface QaMessage {
  reasoningContent?: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  toolCallId?: string;
  toolCalls?: QaToolCall[];
}
export interface QaToolCall {
  id: string;
  name: string;
  arguments: string;
}
export interface QaTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    strict: true;
  };
}
export interface QaUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}
export interface QaModelInput {
  /** Correlation only; never sent to the provider. */
  turnId?: string;
  messages: QaMessage[];
  tools?: QaTool[];
  maxOutputTokens: number;
  signal: AbortSignal;
  timeoutMs: number;
}
export interface QaModelPort {
  snapshot(userId: number): QaModelSnapshot;
  count(snapshot: QaModelSnapshot, text: string): number;
  complete(
    userId: number,
    snapshot: QaModelSnapshot,
    input: QaModelInput,
  ): Promise<{ toolCalls: QaToolCall[]; usage: QaUsage; reasoningContent?: string; content?: string | null }>;
  stream(
    userId: number,
    snapshot: QaModelSnapshot,
    input: QaModelInput,
    onDelta: (text: string) => Promise<void>,
  ): Promise<{ usage: QaUsage; finishReason: string | null }>;
}
export interface QaEvidence {
  contextTruncated?: boolean;
  locator: {
    version: 1;
    bookId: number;
    contentRevision: {
      fileChecksum: string;
      extractorVersion: string;
      normalizationVersion: string;
    };
    position: {
      kind: "epub_text";
      sectionIndex: number;
      start: number;
      end: number;
    };
  };
  quote: string;
  quoteHash: string;
  displayedQuote: string;
  sectionIndex: number;
  href: string;
  start: number;
  end: number;
  cfi: string;
}
export interface QaSavedEvidence extends QaEvidence {
  evidenceId: string;
  importedFromTurnId?: string;
}
export interface QaCurrentBook {
  bookId: number;
  title: string;
}
export interface QaCurrentBookPort {
  get(userId: number, bookId: number): QaCurrentBook;
}
export interface QaBookPort {
  index(
    userId: number,
    selection: SelectionSnapshot,
  ): Promise<{ state: "building"; generation: string } | { state: "ready" }>;
  context(
    userId: number,
    selection: SelectionSnapshot,
    input: {
      sectionIndex: number;
      href: string;
      start: number;
      end: number;
      maxChars: number;
      deadline: number;
      signal: AbortSignal;
    },
  ): Promise<QaEvidence>;
  searchCandidates(
    userId: number,
    selection: SelectionSnapshot,
    input: {
      queries: string[];
      informationNeed: string;
      limit: number;
      maxChars: number;
      deadline: number;
      signal: AbortSignal;
    },
  ): Promise<
    | { state: "building"; generation: string }
    | { state: "ready"; candidates: QaEvidence[]; unavailable: unknown[]; budgetLimited: boolean; contextTruncated: boolean }
  >;
  /** Fused unverified candidates; only verifyCandidates output may become evidence. */
  searchPool(
    userId: number,
    selection: SelectionSnapshot,
    input: { queries: string[]; informationNeed: string; poolLimit: number; deadline: number; signal: AbortSignal },
  ): Promise<
    | { state: "building"; generation: string }
    | { state: "ready"; candidates: QaPoolCandidate[]; unavailable: unknown[]; lists: unknown[]; pipeline: { tokenizerVersion: string; queryPolicyVersion: string } }
  >;
  verifyCandidates(
    userId: number,
    selection: SelectionSnapshot,
    input: { candidates: QaPoolCandidate[]; limit: number; maxChars: number; deadline: number; signal: AbortSignal },
  ): Promise<{ candidates: QaEvidence[]; admitted: number[]; budgetLimited: boolean }>;
  expandSelected(
    userId: number,
    selection: SelectionSnapshot,
    input: {
      evidence: QaEvidence[];
      maxChars: number;
      maxWindowChars: number;
      deadline: number;
      signal: AbortSignal;
    },
  ): Promise<{
    candidates: QaEvidence[];
    contextWindows: Array<{ sectionIndex: number; start: number; end: number; hitRanges: Array<{ sectionIndex: number; start: number; end: number }> }>;
    contextTruncated: boolean;
  }>;
  replay(
    userId: number,
    selection: SelectionSnapshot,
    evidence: QaEvidence[],
    deadline: number,
    signal: AbortSignal,
  ): Promise<QaEvidence[]>;
}
/** An index candidate before replay. Text may be shown to a reranker, never cited. */
export interface QaPoolCandidate {
  sectionIndex: number;
  href: string;
  start: number;
  end: number;
  quote: string;
  quoteHash: string;
  displayedQuote: string;
  cfi: string;
  fusedRank: number;
  paths: Array<{ kind: string; query: string; rank: number }>;
}
export type QaRerankFailure = "timeout" | "http" | "protocol" | "quota" | "cancelled";
export class QaRerankError extends Error {
  constructor(readonly kind: QaRerankFailure, message: string) { super(message); this.name = "QaRerankError"; }
}
export interface QaRerankerPort {
  readonly identity: { provider: string; model: string };
  rank(input: { query: string; documents: string[]; timeoutMs: number; signal: AbortSignal }):
    Promise<{ scores: number[]; usage: { requests: number; totalTokens: number | null }; requestId: string | null }>;
}
/** How search results reach the planning model. `none` requires a reranker. */
export type QaSearchMode =
  | { reranker: null; screening: "llm" }
  | { reranker: QaRerankerPort; screening: "llm" | "none" };
export const SELECTION_QA_SEARCH_MODE = Symbol("SELECTION_QA_SEARCH_MODE");
export interface QaClaim {
  turn: Turn;
  conversation: Conversation;
  snapshot: QaModelSnapshot;
  token: string;
  generation: number;
  owner: string;
}
export interface QaRuntimeStore {
  claim(owner: string, now: number): QaClaim | null;
  maintain(now: number): void;
  mutate<T>(claim: QaClaim, now: number, action: () => T): T;
  renew(claim: QaClaim, now: number): void;
  reserveModel(claim: QaClaim, kind: "decision" | "final" | "check"): void;
  reserveTool(claim: QaClaim): number;
  chargeRead(claim: QaClaim, chars: number): void;
  remaining(claim: QaClaim): { models: number; tools: number; chars: number };
  phase(claim: QaClaim, phase: string, details?: Record<string, unknown>): void;
  usage(claim: QaClaim, usage: QaUsage, maxOutputTokens: number): void;
  evidence(claim: QaClaim, evidence: QaSavedEvidence): void;
  beginAnswer(claim: QaClaim, version: number): void;
  quality(claim: QaClaim, value: QaQualityJudgment): void;
  append(claim: QaClaim, text: string, citations: QaSavedEvidence[]): void;
  finish(
    claim: QaClaim,
    status: "completed" | "failed" | "timed_out",
    reason: string | null,
  ): void;
  history(claim: QaClaim): {
    research: QaPriorSearch[];
    turns: Array<Pick<Turn, "id" | "question" | "answer" | "status">>;
    historicalEvidence: Array<QaSavedEvidence & { turnId: string }>;
  };
}

export interface QaQualityJudgment {
  answerVersion: number;
  generation: number;
  answerHash: string;
  evidenceFingerprint: string;
  evidenceIds: string[];
  inputFingerprint: string;
  revision: SelectionSnapshot["scope"];
  policy: "all-answers-v1";
  verdict: "pass" | "revise" | "insufficient";
  issues: Array<{ claim: string; problem: string; evidenceIds: string[]; action: string }>;
}

/** Completed searches and their completed research decisions, scoped to this conversation/revision. */
export interface QaPriorSearch {
  turnId: string;
  question: string;
  informationNeed: string;
  queries: string[];
  resultCount: number;
  /** null means this historical event did not record candidate IDs. */
  selectedCandidateCount: number | null;
  unresolved: boolean;
}
