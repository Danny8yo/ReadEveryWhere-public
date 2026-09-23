import {
  AiReadingDomainError,
  jsonClone,
  requireIsoDate,
  requireNonEmpty,
} from './domain-error';

export type ReadingEventType =
  | 'task_queued'
  | 'task_started'
  | 'task_resumed'
  | 'plan_updated'
  | 'agent_started'
  | 'agent_queued'
  | 'agent_waiting_children'
  | 'agent_resumed'
  | 'agent_progress'
  | 'agent_completed'
  | 'agent_failed'
  | 'tool_started'
  | 'tool_observation'
  | 'evidence_recorded'
  | 'evidence_imported'
  | 'answer_started'
  | 'answer_delta'
  | 'answer_completed'
  | 'budget_updated'
  | 'recovery_attempted'
  | 'task_completed'
  | 'task_partial'
  | 'task_needs_input'
  | 'task_failed'
  | 'task_cancelled';

export type PublicReadingEventKind =
  | 'task'
  | 'plan'
  | 'agent'
  | 'commentary'
  | 'tool'
  | 'evidence'
  | 'answer'
  | 'budget'
  | 'recovery';

export interface PublicPlanStep {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

export interface PublicTaskDetail {
  status?: string;
  goal?: string;
  reasonCode?: string;
  budgetTier?: string;
  budgetMode?: string;
  budgetPolicy?: Record<string, number>;
}

export interface PublicPlanDetail {
  before: PublicPlanStep[];
  after: PublicPlanStep[];
  nextAction?: string;
}

export interface PublicAgentDetail {
  role: 'root' | 'subagent';
  goal?: string;
  status: string;
  parentRunId?: string;
  findingCount?: number;
  evidenceIds?: string[];
  errorCode?: string;
}

export interface PublicCommentaryDetail {
  phase: 'completed';
  text: string;
}

export interface PublicToolDetail {
  phase: 'started' | 'completed' | 'failed';
  purpose?: string;
  arguments?: Record<string, unknown>;
  result?: Record<string, unknown>;
  evidenceIds?: string[];
  durationMs?: number;
  errorCode?: string;
  retryable?: boolean;
  recoveryAction?: string;
}

export interface PublicEvidenceDetail {
  quote?: string;
  chapterPath?: string;
  citation?: Record<string, unknown>;
}

export interface PublicAnswerDetail {
  phase: 'started' | 'streaming' | 'completed';
  answerId: string;
  mode?: 'model' | 'fallback';
  offset?: number;
  delta?: string;
  text?: string;
  characterCount?: number;
  evidenceIds?: string[];
}

export interface PublicBudgetDetail {
  cause: 'model_call' | 'tool_call' | 'delegation' | 'recovery';
  delta: {
    modelTurns: number;
    toolCalls: number;
    readCharacters: number;
    delegatedAgents: number;
  };
  callDurationMs: number;
  remaining: {
    modelTurns: number;
    toolCalls: number;
    readCharacters: number;
    durationMs: number;
    delegatedAgents: number;
    concurrentAgents: number;
  };
  exhaustedBy: string[];
}

export interface PublicRecoveryDetail {
  errorCode: string;
  retryable: boolean;
  recoveryAction?: string;
  attempt?: number;
  relatedAgentRunId?: string;
}

export type PublicReadingEventDetail =
  | PublicTaskDetail
  | PublicPlanDetail
  | PublicAgentDetail
  | PublicCommentaryDetail
  | PublicToolDetail
  | PublicEvidenceDetail
  | PublicAnswerDetail
  | PublicBudgetDetail
  | PublicRecoveryDetail
  | { truncated: true };

interface PublicReadingEventPayloadV2Base {
  schemaVersion: 2;
  title: string;
  summary?: string;
  toolName?: string;
  truncated?: true;
}

export type PublicReadingEventPayloadV2 = PublicReadingEventPayloadV2Base & (
  | { kind: 'task'; detail: PublicTaskDetail | { truncated: true } }
  | { kind: 'plan'; detail: PublicPlanDetail | { truncated: true } }
  | { kind: 'agent'; detail: PublicAgentDetail | { truncated: true } }
  | { kind: 'commentary'; detail: PublicCommentaryDetail | { truncated: true } }
  | { kind: 'tool'; toolName: string; detail: PublicToolDetail | { truncated: true } }
  | { kind: 'evidence'; detail: PublicEvidenceDetail | { truncated: true } }
  | { kind: 'answer'; detail: PublicAnswerDetail | { truncated: true } }
  | { kind: 'budget'; detail: PublicBudgetDetail | { truncated: true } }
  | { kind: 'recovery'; detail: PublicRecoveryDetail | { truncated: true } }
);

export interface LegacyPublicReadingEventPayload {
  schemaVersion: 1;
  legacy: true;
  kind: PublicReadingEventKind;
  title: string;
  summary?: string;
  toolName?: string;
  detail: { unavailable: true };
}

export type PublicReadingEventPayload =
  | PublicReadingEventPayloadV2
  | LegacyPublicReadingEventPayload;

export interface ReadingEventJSON {
  sequence: number;
  type: ReadingEventType;
  occurredAt: string;
  taskId: string;
  agentRunId?: string;
  parentRunId?: string;
  stepId?: string;
  modelCallId?: string;
  toolCallId?: string;
  evidenceId?: string;
  payload: Record<string, unknown> | PublicReadingEventPayload;
}

const EVENT_TYPES: ReadonlySet<ReadingEventType> = new Set([
  'task_queued',
  'task_started',
  'task_resumed',
  'plan_updated',
  'agent_started',
  'agent_queued',
  'agent_waiting_children',
  'agent_resumed',
  'agent_progress',
  'agent_completed',
  'agent_failed',
  'tool_started',
  'tool_observation',
  'evidence_recorded',
  'evidence_imported',
  'answer_started',
  'answer_delta',
  'answer_completed',
  'budget_updated',
  'recovery_attempted',
  'task_completed',
  'task_partial',
  'task_needs_input',
  'task_failed',
  'task_cancelled',
]);

export class ReadingEvent {
  private constructor(private readonly value: ReadingEventJSON) {}

  static create(value: ReadingEventJSON): ReadingEvent {
    if (!Number.isSafeInteger(value.sequence) || value.sequence <= 0) {
      throw new AiReadingDomainError(
        'READING_EVENT_INVALID',
        'sequence must be a positive safe integer',
      );
    }
    requireNonEmpty(value.taskId, 'READING_EVENT_INVALID', 'taskId');
    requireIsoDate(value.occurredAt, 'READING_EVENT_INVALID', 'occurredAt');
    if (!EVENT_TYPES.has(value.type)) {
      throw new AiReadingDomainError(
        'READING_EVENT_INVALID',
        'unknown event type',
      );
    }
    if (!value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload)) {
      throw new AiReadingDomainError(
        'READING_EVENT_INVALID',
        'payload must be a JSON object',
      );
    }
    if (
      'schemaVersion' in value.payload
      && value.payload.schemaVersion !== 1
      && value.payload.schemaVersion !== 2
    ) {
      throw new AiReadingDomainError(
        'READING_EVENT_INVALID',
        'unknown public payload schema version',
      );
    }
    return new ReadingEvent(jsonClone(value, 'READING_EVENT_INVALID'));
  }

  static fromJSON(value: ReadingEventJSON): ReadingEvent {
    return ReadingEvent.create(value);
  }

  get sequence(): number {
    return this.value.sequence;
  }

  get type(): ReadingEventType {
    return this.value.type;
  }

  get taskId(): string {
    return this.value.taskId;
  }

  get agentRunId(): string | undefined {
    return this.value.agentRunId;
  }

  toJSON(): ReadingEventJSON {
    return jsonClone(this.value, 'READING_EVENT_INVALID');
  }
}
