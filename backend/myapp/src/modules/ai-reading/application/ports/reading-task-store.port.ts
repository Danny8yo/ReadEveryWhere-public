import type {
  EvidenceRecord,
  ReadingEventJSON,
  ReadingTask,
} from "../../domain";
import type { AgentRunLease } from "./agent-run-store.port";

export interface ReadingEventPage {
  items: ReadingEventJSON[];
  nextSequence: number;
  hasMore: boolean;
}

export type TaskWriteAuthority =
  | { kind: "system" }
  | { kind: "agent_lease"; lease: AgentRunLease; now: string };

export interface ReadingTaskStorePort {
  save(task: ReadingTask, authority: TaskWriteAuthority): boolean;
  findForUser(taskId: string, userId: number): ReadingTask | null;
  findInternal(taskId: string): ReadingTask | null;
  cancelForUser(taskId: string, userId: number, now: string): ReadingTask | null;
  isCancellationRequested(taskId: string): boolean;
  appendEvent(
    value: Omit<ReadingEventJSON, "sequence">,
    authority: TaskWriteAuthority,
  ): ReadingEventJSON | null;
  listEvents(
    taskId: string,
    userId: number,
    afterSequence: number,
    limit: number,
  ): ReadingEventPage;
  appendMessage(
    taskId: string,
    agentRunId: string,
    role: string,
    content: unknown,
    authority: TaskWriteAuthority,
  ): boolean;
  appendAudit(
    taskId: string,
    agentRunId: string | null,
    kind: string,
    metadata: unknown,
    authority: TaskWriteAuthority,
    ids?: { stepId?: string; modelCallId?: string; toolCallId?: string },
  ): boolean;
  replaceEvidence(
    taskId: string,
    evidence: EvidenceRecord[],
    authority: TaskWriteAuthority,
  ): boolean;
  listEvidence(taskId: string, userId: number): EvidenceRecord[];
}
