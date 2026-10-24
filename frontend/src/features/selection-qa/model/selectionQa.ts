import type {
  ContentScope,
  ResolvedSelection,
} from "@readeverywhere/epub-core/types";
import type { Annotation, AnnotationType } from "../../reader/model/annotation";
export interface LoadedEpubIdentity {
  fileChecksum: string;
  extractorVersion: string;
  normalizationVersion: string;
}
export interface EpubSelectionAnchor {
  sectionIndex: number;
  href: string;
  cfi: string;
  displayedQuote: string;
}
export interface SelectionRequest {
  scope: ContentScope;
  cfi: string;
  displayedQuote: string;
}
export interface SelectionSnapshot extends ResolvedSelection {
  artifact: { bookId: number; artifactId: string; fileChecksum: string };
}
export interface Conversation {
  id: string;
  bookId: number;
  selection: SelectionSnapshot;
  status: "active" | "frozen";
  frozenReason: string | null;
  firstQuestion: string;
  createdAt: number;
  updatedAt: number;
}
export interface Evidence {
  evidenceId: string;
  quote: string;
  quoteHash: string;
  cfi: string;
  sectionIndex: number;
  href: string;
  start: number;
  end: number;
  displayedQuote: string;
}
/** Additive status projection; historical rows may lack research-decision fields. */
export interface QaProcessDetail extends Record<string, unknown> {
  observationStatus?: 'success' | 'empty' | 'recoverable_error' | 'not_executed' | 'interrupted' | 'failed';
  informationNeed?: string;
  informationNeeds?: Array<string | { text: string; targetSource: 'current_book' | 'model_knowledge' | 'other_book_unverified'; sourceName: string; evidenceIds: string[] }>;
  selectedEvidenceIds?: string[];
  rejectedEvidenceIds?: string[];
  budgetOmittedEvidenceIds?: string[];
  externalEvidenceNeeded?: string[];
  insufficientEvidence?: string[];
  conclusion?: string;
}
export interface Turn {
  id: string;
  conversationId: string;
  turnNumber: number;
  question: string;
  answer: string;
  answerVersion?: number;
  quality?: { answerVersion: number; verdict: "pass" | "revise" | "insufficient" };
  status:
    | "queued"
    | "running"
    | "completed"
    | "cancelled"
    | "failed"
    | "timed_out";
  phase: string;
  process?: Array<{ sequence: number; at: number; phase: string; detail: QaProcessDetail }>;
  citations: Evidence[];
  errorCode: string | null;
  lastSequence: number;
  deadline: number;
}
export interface QaEvent {
  schemaVersion: 1 | 2;
  turnId: string;
  sequence: number;
  kind: "status" | "answer_delta" | "citation" | "terminal";
  data: Record<string, unknown>;
}
export interface ValidatedLocation {
  scope: ContentScope;
  artifact: { bookId: number; artifactId: string; fileChecksum: string };
  cfi: string;
  quote: string;
  quoteHash: string;
  locator: unknown;
}
export type ApplyTarget =
  | {
      kind: "create";
      annotationType: AnnotationType;
      color: string;
      cfi: string;
      chapterLabel?: string;
    }
  | { kind: "append"; annotationId: string; expectedRevision: number };
export interface ApplyResult {
  receipt: {
    commandId: string;
    annotation: Annotation;
    readingStateVersion: number;
    createdAt: number;
  };
  currentAnnotation: Annotation | null;
  replayed: boolean;
}
export type PendingCommand =
  | {
      kind: "create";
      body: {
        commandId: string;
        bookId: number;
        selection: SelectionRequest;
        question: string;
      };
    }
  | {
      kind: "turn";
      conversationId: string;
      body: { commandId: string; question: string; retryOfTurnId?: string };
    }
  | {
      kind: "apply";
      turnId: string;
      body: { commandId: string; appendText: string; target: ApplyTarget; answerVersion?: number; acceptUnverified?: boolean };
    };
export interface QaApi {
  conversations(
    bookId: number,
    cursor?: string,
  ): Promise<{ items: Conversation[]; nextCursor: string | null }>;
  conversation(id: string): Promise<Conversation>;
  turns(
    id: string,
    cursor?: number,
  ): Promise<{ items: Turn[]; nextCursor: number | null }>;
  execute(
    command: PendingCommand,
  ): Promise<{ conversation: Conversation; turn: Turn } | Turn | ApplyResult>;
  receipt(commandId: string): Promise<ApplyResult | null>;
  stop(id: string): Promise<Turn>;
  delete(id: string): Promise<void>;
  location(
    conversationId: string,
    turnId?: string,
    evidenceId?: string,
  ): Promise<ValidatedLocation>;
  annotations(bookId: number): Promise<Annotation[]>;
  subscribe(
    turnId: string,
    after: number,
    handlers: {
      event: (event: QaEvent) => void;
      error: (error: unknown) => void;
      end: () => void;
    },
  ): () => void;
}
export const isActive = (turn: Turn) =>
  turn.status === "queued" || turn.status === "running";
