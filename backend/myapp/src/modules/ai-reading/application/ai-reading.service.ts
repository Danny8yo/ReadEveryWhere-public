import {
  BUDGET_POLICIES,
  BUDGET_POLICY_CONSTRAINTS,
  CHILD_AGENT_EXECUTION_LIMITS,
  ReadingTask,
  type BudgetPolicy,
  type BudgetPolicyInput,
  type ReadingEventJSON,
} from "../domain";
import type { ReadingTaskStorePort } from "./ports/reading-task-store.port";
import type { AgentRunStorePort } from './ports/agent-run-store.port';
import type { BudgetLedgerStorePort } from './ports/budget-ledger-store.port';
import type { ActiveAgentRunCancellationPort } from './ports/agent-run-executor.port';
import { toPublicReadingEventPayload } from "./public-reading-event";
import { AiReadingApplicationError } from "./application-error";

export class AiReadingService {
  constructor(
    private readonly tasks: ReadingTaskStorePort,
    private readonly agentRuns?: Pick<AgentRunStorePort, 'listForTask'>,
    private readonly taskBudgets?: Pick<BudgetLedgerStorePort, 'find'>,
    private readonly scheduler?: ActiveAgentRunCancellationPort,
  ) {}

  getBudgetConfig() {
    return {
      version: 2 as const,
      presets: {
        quick: policyInput(BUDGET_POLICIES.quick),
        standard: policyInput(BUDGET_POLICIES.standard),
        deep: policyInput(BUDGET_POLICIES.deep),
      },
      constraints: Object.fromEntries(
        Object.entries(BUDGET_POLICY_CONSTRAINTS).map(([key, value]) => [
          key,
          { ...value },
        ]),
      ),
      executionLimits: {
        maxDelegationDepth: parseExecutionLimit('AI_READING_MAX_DELEGATION_DEPTH', 2, 1, 2),
        maxChildrenPerAgent: 3,
        maxDelegatedAgentsPerDepth: 3,
        maxActiveTurns: parseExecutionLimit('AI_READING_TURN_CONCURRENCY', 2, 1, 2),
        maxActiveAgentRuns: parseExecutionLimit('AI_READING_AGENT_CONCURRENCY', 4, 1, 4),
        childMaxModelTurns: CHILD_AGENT_EXECUTION_LIMITS.modelTurns,
        childMaxToolCalls: CHILD_AGENT_EXECUTION_LIMITS.toolCalls,
        childMaxReadCharacters: CHILD_AGENT_EXECUTION_LIMITS.readCharacters,
        childMaxExecutionMs: CHILD_AGENT_EXECUTION_LIMITS.executionMs,
      },
    };
  }

  getTask(userId: number, taskId: string) {
    return this.toDetail(this.requireTask(userId, taskId));
  }

  listEvents(userId: number, taskId: string, afterSequence: number, limit: number) {
    this.requireTask(userId, taskId);
    const page = this.tasks.listEvents(taskId, userId, afterSequence, limit);
    return { ...page, items: page.items.map(toPublicEvent) };
  }

  cancelTask(userId: number, taskId: string) {
    const task = this.requireTask(userId, taskId);
    if (!["queued", "running"].includes(task.status)) return this.toDetail(task);
    const cancelled = this.tasks.cancelForUser(taskId, userId, new Date().toISOString());
    if (!cancelled) throw notFound("taskId", "AI reading task not found");
    this.scheduler?.abortTask(taskId);
    return this.toDetail(cancelled);
  }

  private requireTask(userId: number, taskId: string): ReadingTask {
    const task = this.tasks.findForUser(taskId, userId);
    if (!task) throw notFound("taskId", "AI reading task not found");
    return task;
  }

  private toSummary(task: ReadingTask) {
    const value = task.toJSON();
    const root = value.runs.find((run) => run.depth === 0);
    return {
      id: value.id,
      bookId: Number(value.scope.bookId),
      goal: value.goal,
      budgetTier: value.budgetTier,
      budgetMode: task.budgetMode,
      status: value.status,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      startedAt: root?.startedAt ?? null,
      completedAt: value.finishedAt ?? null,
    };
  }

  private toDetail(task: ReadingTask) {
    const value = task.toJSON();
    const v2Runs = this.agentRuns?.listForTask(task.id) ?? [];
    const isV2 = v2Runs.length > 0;
    const snapshot = task.budgetSnapshot(new Date().toISOString());
    const taskBudget = isV2 ? this.taskBudgets?.find(task.id) : null;
    const childRuns = isV2 ? v2Runs.filter((run) => run.depth > 0) : task.listRuns().filter((run) => run.depth > 0);
    const activeChildRuns = childRuns.filter((run) => ['queued', 'running', 'waiting_children'].includes(run.status));
    const evidence = this.tasks.listEvidence(task.id, Number(task.userId)).map((item) => ({
      id: item.evidenceId,
      quote: item.quote,
      citation: {
        ...item.citation,
        bookId: Number(item.citation.bookId),
      },
    }));
    const result = value.result
      ? {
          ...(value.result.answerText ? { answerText: value.result.answerText } : {}),
          bookFindings: value.result.bookFindings.map((item, index) => ({
            id: `book-${index + 1}`,
            statement: item.text,
            evidenceIds: item.evidenceIds,
          })),
          inferences: value.result.inferences.map((item, index) => ({
            id: `inference-${index + 1}`,
            statement: item.text,
            evidenceIds: item.evidenceIds,
          })),
          modelKnowledge: value.result.backgroundKnowledge.map((item, index) => ({
            id: `knowledge-${index + 1}`,
            statement: item.text,
            evidenceIds: [],
          })),
          openQuestions: value.result.openQuestions,
          limitations: value.result.limitations,
          evidence,
        }
      : null;
    return {
      ...this.toSummary(task),
      contentRevision: JSON.parse(value.scope.contentRevision),
      plan: value.plan.map((step) => ({ id: step.id, title: step.description, status: step.status })),
      agents: (isV2 ? v2Runs : value.runs).map((run) => ({
        id: run.id,
        parentRunId: run.parentRunId ?? null,
        kind: run.depth === 0 ? "root" as const : "subagent" as const,
        depth: run.depth,
        goal: run.goal,
        ...('deliverable' in run ? { deliverable: run.deliverable } : {}),
        status: run.status,
        ...('usage' in run && run.usage ? { usage: run.usage } : {}),
        ...('nodeLimits' in run ? { limits: run.nodeLimits } : {}),
        terminalReason: 'terminalReason' in run ? run.terminalReason ?? null : null,
      })),
      budget: {
        limits: {
          modelTurns: snapshot.policy.maxModelTurns,
          toolCalls: snapshot.policy.maxToolCalls,
          readCharacters: snapshot.policy.maxReadCharacters,
          durationMs: snapshot.policy.maxDurationMs,
          delegatedAgents: snapshot.policy.maxDelegatedAgents,
          concurrentAgents: snapshot.policy.maxConcurrentAgents,
        },
        used: {
          ...(taskBudget ? {
            modelTurns: taskBudget.used.modelTurns,
            toolCalls: taskBudget.used.toolCalls,
            readCharacters: taskBudget.used.readCharacters,
          } : snapshot.used),
          durationMs: Math.min(snapshot.elapsedMs, snapshot.policy.maxDurationMs),
          delegatedAgents: childRuns.length,
          concurrentAgents: activeChildRuns.length,
          ...(taskBudget ? {
            promptTokens: taskBudget.promptTokens,
            completionTokens: taskBudget.completionTokens,
            totalTokens: taskBudget.totalTokens,
            cacheReadInputTokens: taskBudget.cacheReadInputTokens ?? null,
            cacheWriteInputTokens: taskBudget.cacheWriteInputTokens ?? null,
            uncachedInputTokens: taskBudget.uncachedInputTokens ?? null,
          } : {}),
        },
        remaining: {
          ...(taskBudget ? {
            modelTurns: Math.max(0, taskBudget.policy.modelTurns - taskBudget.used.modelTurns - taskBudget.reserved.modelTurns),
            toolCalls: Math.max(0, taskBudget.policy.toolCalls - taskBudget.used.toolCalls - taskBudget.reserved.toolCalls),
            readCharacters: Math.max(0, taskBudget.policy.readCharacters - taskBudget.used.readCharacters - taskBudget.reserved.readCharacters),
          } : snapshot.remaining),
          durationMs: Math.max(0, snapshot.policy.maxDurationMs - snapshot.elapsedMs),
          delegatedAgents: Math.max(0, snapshot.policy.maxDelegatedAgents - childRuns.length),
          concurrentAgents: Math.max(0, snapshot.policy.maxConcurrentAgents - activeChildRuns.length),
        },
      },
      result,
      evidence,
    };
  }
}

function notFound(field: string, message: string): AiReadingApplicationError {
  return new AiReadingApplicationError("not_found", message, {
    field,
    reason: "RESOURCE_NOT_FOUND",
  });
}

function parseExecutionLimit(name: string, fallback: number, min: number, max: number): number {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function policyInput(policy: BudgetPolicy): BudgetPolicyInput {
  return {
    maxModelTurns: policy.maxModelTurns,
    maxToolCalls: policy.maxToolCalls,
    maxReadCharacters: policy.maxReadCharacters,
    maxDurationMs: policy.maxDurationMs,
    maxDelegatedAgents: policy.maxDelegatedAgents,
    maxConcurrentAgents: policy.maxConcurrentAgents,
  };
}

function toPublicEvent(event: ReadingEventJSON) {
  return {
    sequence: event.sequence,
    type: event.type,
    createdAt: event.occurredAt,
    agentRunId: event.agentRunId ?? null,
    parentRunId: event.parentRunId ?? null,
    payload: toPublicReadingEventPayload(event.type, event.payload),
    stepId: event.stepId,
    modelCallId: event.modelCallId,
    toolCallId: event.toolCallId,
    evidenceId: event.evidenceId,
  };
}
