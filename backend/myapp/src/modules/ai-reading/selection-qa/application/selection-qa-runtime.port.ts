import type {
  Conversation,
  SelectionSnapshot,
  Turn,
} from "./selection-qa.types";
export const SELECTION_QA_MODEL_PORT = Symbol("SELECTION_QA_MODEL_PORT");
export const QA_POLICY = Object.freeze({
  version: "selection-qa-v5-repair-budget",
  /** Ordinary decision calls: two searches followed by one evidence decision. */
  maxPlanningCalls: 3,
  /** Extra decision calls granted only after a repairable model protocol error. */
  maxProtocolRepairAttempts: 2,
  /** Absolute persisted cap: planning + repairs + the reserved final stream. */
  maxModelCalls: 6,
  maxToolCalls: 6,
  maxReadChars: 24000,
  deadlineMs: 240000,
  maxAnswerChars: 64000,
  planningOutputTokens: 3072,
  answerOutputTokens: 8192,
  leaseMs: 10000,
});
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
      limit: number;
      maxChars: number;
      deadline: number;
      signal: AbortSignal;
    },
  ): Promise<
    | { state: "building"; generation: string }
    | { state: "ready"; candidates: QaEvidence[]; unavailable: unknown[]; budgetLimited: boolean; contextTruncated: boolean }
  >;
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
  reserveModel(claim: QaClaim, kind: "planning" | "protocol_repair" | "final"): void;
  reserveTool(claim: QaClaim): number;
  chargeRead(claim: QaClaim, chars: number): void;
  remaining(claim: QaClaim): { models: number; tools: number; chars: number };
  phase(claim: QaClaim, phase: string, details?: Record<string, unknown>): void;
  usage(claim: QaClaim, usage: QaUsage, maxOutputTokens: number): void;
  evidence(claim: QaClaim, evidence: QaSavedEvidence): void;
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
