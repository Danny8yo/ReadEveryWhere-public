import type { QaModelSnapshot } from "./selection-qa-runtime.port";
import type { ResolvedSelection } from "@readeverywhere/epub-core/types";
export class SelectionQaError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 409,
    public readonly current?: unknown,
  ) {
    super(code);
  }
}
export interface SelectionSnapshot extends ResolvedSelection {
  artifact: { bookId: number; artifactId: string; fileChecksum: string };
}
export interface SelectionQaContentPort {
  resolve(
    userId: number,
    bookId: number,
    selection: unknown,
  ): Promise<SelectionSnapshot>;
  assertCurrent(userId: number, selection: SelectionSnapshot): void;
}
export const SELECTION_QA_CONTENT = Symbol("SELECTION_QA_CONTENT");
export interface Conversation {
  id: string;
  userId: number;
  bookId: number;
  selection: SelectionSnapshot;
  status: "active" | "frozen";
  frozenReason: string | null;
  firstQuestion: string;
  createdAt: number;
  updatedAt: number;
}
/** Additive status projection; historical rows may lack research-decision fields. */
export interface QaProcessDetail extends Record<string, unknown> {
  informationNeed?: string;
  informationNeeds?: Array<string | { text: string; targetSource: "current_book" | "model_knowledge" | "other_book_unverified"; sourceName: string; evidenceIds: string[] }>;
  selectedEvidenceIds?: string[];
  rejectedEvidenceIds?: string[];
  externalEvidenceNeeded?: string[];
  insufficientEvidence?: string[];
  conclusion?: string;
}
export interface Turn {
  id: string;
  userId: number;
  conversationId: string;
  turnNumber: number;
  question: string;
  answer: string;
  answerVersion?: number;
  quality?: import("./selection-qa-runtime.port").QaQualityJudgment;
  status:
    "queued" | "running" | "completed" | "cancelled" | "failed" | "timed_out";
  errorCode: string | null;
  retryOfTurnId: string | null;
  deadline: number;
  lastSequence: number;
  phase: string;
  process?: Array<{ sequence: number; at: number; phase: string; detail: QaProcessDetail }>;
  citations: import("./selection-qa-runtime.port").QaSavedEvidence[];
  createdAt: number;
  updatedAt: number;
}
export type CommandResult = { conversation: Conversation; turn: Turn } | Turn;
export interface SelectionQaEvent {
  schemaVersion: 1 | 2;
  turnId: string;
  sequence: number;
  kind: "status" | "answer_delta" | "citation" | "terminal";
  data: Record<string, unknown>;
}
export interface SelectionQaStore {
  subscribe(userId: number, turnId: string, listener: () => void): () => void;
  transact<T>(fn: () => T): T;
  receipt(userId: number, id: string, digest: string): CommandResult | null;
  saveReceipt(
    userId: number,
    id: string,
    digest: string,
    result: CommandResult,
  ): void;
  conversation(userId: number, id: string): Conversation;
  turn(userId: number, id: string): Turn;
  createConversation(value: Conversation): void;
  createTurn(value: Turn, snapshot: QaModelSnapshot): void;
  activeTurn(userId: number, id: string): Turn | null;
  nextTurnNumber(userId: number, id: string): number;
  freeze(userId: number, id: string): void;
  stop(userId: number, id: string, reason?: string): Turn;
  delete(userId: number, id: string): void;
  conversations(
    userId: number,
    bookId: number,
    cursor: string | undefined,
    limit: number,
  ): Conversation[];
  turns(userId: number, id: string, after: number, limit: number): Turn[];
  findEvidence(
    userId: number,
    turnId: string,
    evidenceId: string,
  ): import("./selection-qa-runtime.port").QaSavedEvidence;
  events(userId: number, id: string, after: number): SelectionQaEvent[];
}
export const SELECTION_QA_STORE = Symbol("SELECTION_QA_STORE");
