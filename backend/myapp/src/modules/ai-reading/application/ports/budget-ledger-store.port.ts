export type BudgetReservationKind = "model" | "tool" | "read" | "delegate";

export interface BudgetCounters {
  modelTurns: number;
  toolCalls: number;
  readCharacters: number;
  delegatedAgents: number;
}

export interface TaskBudgetRecord {
  taskId: string;
  policy: BudgetCounters & { deadlineAt: string; concurrentAgents?: number };
  used: BudgetCounters;
  reserved: BudgetCounters;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadInputTokens?: number | null;
  cacheWriteInputTokens?: number | null;
  uncachedInputTokens?: number | null;
  version: number;
}

export interface NodeBudgetLimits {
  modelTurns: number;
  toolCalls: number;
  readCharacters: number;
}

export interface BudgetReservationRequest {
  id: string;
  taskId: string;
  agentRunId: string;
  stepId: string;
  kind: BudgetReservationKind;
  amount: Partial<BudgetCounters>;
  nodeLimits: NodeBudgetLimits;
  now: string;
}

export interface BudgetSettlement {
  amount: Partial<BudgetCounters>;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cacheReadInputTokens?: number | null;
  cacheWriteInputTokens?: number | null;
  uncachedInputTokens?: number | null;
  settledAt: string;
}

export interface BudgetLedgerStorePort {
  create(record: TaskBudgetRecord): void;
  find(taskId: string): TaskBudgetRecord | null;
  reserve(request: BudgetReservationRequest, authority: AgentRunWriteAuthority):
    "reserved" | "existing" | "exhausted" | "deadline" | "fenced";
  settle(reservationId: string, settlement: BudgetSettlement, authority: AgentRunWriteAuthority): boolean;
  release(reservationId: string, settledAt: string, authority: AgentRunWriteAuthority): boolean;
}
import type { AgentRunWriteAuthority } from "./agent-run-store.port";
