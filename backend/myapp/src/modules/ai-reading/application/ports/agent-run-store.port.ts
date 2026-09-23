import type { ConversationCheckpoint, ReadingEventJSON, ReadingTask } from '../../domain';
import type { RollingReadingCheckpoint } from '../rolling-reading-state';

export type AgentRunV2Status =
  | "queued"
  | "running"
  | "waiting_children"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";

export interface AgentRunLease {
  agentRunId: string;
  workerId: string;
  leaseToken: string;
  generation: number;
  expiresAt: string;
}

export interface AgentRunWriteAuthority {
  lease: AgentRunLease;
  now: string;
}

export interface AgentRunCheckpointV1 {
  schemaVersion: 1;
  nextStepNo: number;
  messages: Array<{
    role: "assistant" | "tool" | "user";
    content: unknown;
    toolCallId?: string;
    toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  }>;
  childResultIds: string[];
  contextEvidenceIds?: string[];
  repairAttempts?: number;
  outputTruncationAttempts?: number;
  evidenceRepairAttempts?: number;
  readingState?: RollingReadingCheckpoint;
}

export interface AgentRunRecordV2 {
  id: string;
  taskId: string;
  parentRunId?: string;
  depth: number;
  goal: string;
  deliverable: string;
  goalFingerprint: string;
  status: AgentRunV2Status;
  checkpoint: AgentRunCheckpointV1;
  nodeLimits: {
    modelTurns: number;
    toolCalls: number;
    readCharacters: number;
    executionMs: number;
  };
  cancelRequested: boolean;
  terminalReason?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  executionMs?: number;
  result?: unknown;
  usage?: {
    modelTurns: number;
    toolCalls: number;
    readCharacters: number;
    delegatedAgents: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cacheReadInputTokens?: number | null;
    cacheWriteInputTokens?: number | null;
    uncachedInputTokens?: number | null;
  };
}

export interface AgentStepRecord {
  id: string;
  taskId: string;
  agentRunId: string;
  stepNo: number;
  modelCallId?: string;
  toolCallId?: string;
  kind: "model" | "tool" | "delegate";
  status: "started" | "completed" | "failed";
  requestFingerprint: string;
  result?: unknown;
  createdAt: string;
  finishedAt?: string;
}

export interface AgentRunStorePort {
  create(run: AgentRunRecordV2): void;
  createDelegatedChildren(input: {
    parent: AgentRunRecordV2;
    children: AgentRunRecordV2[];
    step: AgentStepRecord;
    authority: AgentRunWriteAuthority;
    budgetReservationId?: string;
    events?: Array<Omit<ReadingEventJSON, 'sequence'>>;
  }): 'created' | 'existing' | 'fenced';
  commitTerminal(input: {
    task?: ReadingTask;
    run: AgentRunRecordV2;
    checkpoint?: ConversationCheckpoint;
    events?: Array<Omit<ReadingEventJSON, 'sequence'>>;
    authority: AgentRunWriteAuthority;
  }): 'committed' | 'fenced';
  find(runId: string): AgentRunRecordV2 | null;
  listForTask(taskId: string): AgentRunRecordV2[];
  claimNext(
    workerId: string,
    now: string,
    maxRunning?: number,
    excludedRunIds?: readonly string[],
  ): { run: AgentRunRecordV2; lease: AgentRunLease } | null;
  renewLease(lease: AgentRunLease, now: string): AgentRunLease | null;
  save(run: AgentRunRecordV2, authority: AgentRunWriteAuthority): boolean;
  startStep(step: AgentStepRecord, authority: AgentRunWriteAuthority): AgentStepRecord | null;
  completeStep(stepId: string, result: unknown, finishedAt: string, authority: AgentRunWriteAuthority): boolean;
  findStep(agentRunId: string, stepNo: number): AgentStepRecord | null;
  cancelTaskRuns(taskId: string, now: string): number;
  resumeReadyParents(now: string): number;
}
