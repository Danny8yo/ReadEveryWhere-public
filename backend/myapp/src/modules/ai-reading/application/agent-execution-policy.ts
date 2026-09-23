import type { ModelToolCall } from './ports/language-model.port';
import type { BudgetTier } from '../domain/budget';
import { goalsAreNearDuplicates } from '../domain/recursive-delegation.policy';
import type { BudgetCounters, NodeBudgetLimits, TaskBudgetRecord } from './ports/budget-ledger-store.port';

const STATE_MAINTENANCE_TOOLS = new Set(['update_plan', 'update_reading_state']);
const TERMINAL_TOOLS = new Set(['complete_turn', 'complete_subtask', 'request_clarification']);

export interface TierExecutionProfile {
  maxDelegationDepth: 0 | 1 | 2;
  childLimits: (NodeBudgetLimits & { executionMs: number }) | null;
}

export function normalizeModelToolCalls(calls: ModelToolCall[]): {
  calls: ModelToolCall[];
  errorCode: 'MODEL_CONTROL_TOOL_MIXED' | null;
} {
  const delegates = calls.filter((call) => call.name === 'delegate_reading');
  if (delegates.length > 0) {
    const maintenance = calls.filter((call) => STATE_MAINTENANCE_TOOLS.has(call.name));
    if (delegates.length !== 1 || maintenance.length + 1 !== calls.length) {
      return { calls, errorCode: 'MODEL_CONTROL_TOOL_MIXED' };
    }
    return { calls: [...maintenance, delegates[0]], errorCode: null };
  }
  if (calls.length > 1 && calls.some((call) => TERMINAL_TOOLS.has(call.name))) {
    return { calls, errorCode: 'MODEL_CONTROL_TOOL_MIXED' };
  }
  return { calls, errorCode: null };
}

export function executionProfileForTier(tier: BudgetTier): TierExecutionProfile {
  if (tier === 'quick') return { maxDelegationDepth: 0, childLimits: null };
  if (tier === 'standard') {
    return {
      maxDelegationDepth: 1,
      childLimits: { modelTurns: 6, toolCalls: 9, readCharacters: 32_000, executionMs: 180_000 },
    };
  }
  return {
    maxDelegationDepth: 2,
    childLimits: { modelTurns: 8, toolCalls: 12, readCharacters: 48_000, executionMs: 180_000 },
  };
}

export function hasIndependentUnfinishedPlanUnits(plan: unknown[]): boolean {
  const unfinished = plan.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const step = value as Record<string, unknown>;
    const status = typeof step.status === 'string' && step.status ? step.status : 'pending';
    const description = typeof step.description === 'string'
      ? step.description.trim()
      : typeof step.title === 'string' ? step.title.trim() : '';
    return description && status !== 'completed' && status !== 'failed' ? [description] : [];
  });
  for (let left = 0; left < unfinished.length; left += 1) {
    for (let right = left + 1; right < unfinished.length; right += 1) {
      if (!goalsAreNearDuplicates(unfinished[left], unfinished[right])) return true;
    }
  }
  return false;
}

export function finalizationMode(input: {
  root: boolean;
  tier?: BudgetTier;
  budget: Pick<TaskBudgetRecord, 'policy' | 'used' | 'reserved'> | null;
  nodeUsage: BudgetCounters;
  nodeLimits?: NodeBudgetLimits & { executionMs?: number };
  evidenceCount: number;
  planComplete?: boolean;
  planProgress?: { total: number; completed: number };
  coverage?: { readCallCount: number; coveredSectionCount: number };
}): boolean {
  if (!input.budget) return true;
  const taskRemaining = {
    modelTurns: remaining(
      input.budget.policy.modelTurns,
      input.budget.used.modelTurns,
      input.budget.reserved.modelTurns,
    ),
    toolCalls: remaining(
      input.budget.policy.toolCalls,
      input.budget.used.toolCalls,
      input.budget.reserved.toolCalls,
    ),
    readCharacters: remaining(
      input.budget.policy.readCharacters,
      input.budget.used.readCharacters,
      input.budget.reserved.readCharacters,
    ),
  };
  const nodeRemaining = input.nodeLimits ? {
    modelTurns: remaining(input.nodeLimits.modelTurns, input.nodeUsage.modelTurns, 0),
    toolCalls: remaining(input.nodeLimits.toolCalls, input.nodeUsage.toolCalls, 0),
    readCharacters: remaining(input.nodeLimits.readCharacters, input.nodeUsage.readCharacters, 0),
  } : taskRemaining;
  const hardReserveReached = Math.min(taskRemaining.toolCalls, nodeRemaining.toolCalls) <= 1
    || Math.min(taskRemaining.modelTurns, nodeRemaining.modelTurns) <= 1;
  if (hardReserveReached) return true;
  if (input.evidenceCount === 0) return false;
  if (input.planComplete === true) return true;
  if (input.root && coverageSaturated(input)) return true;
  return nearTail(taskRemaining, input.budget.policy)
    || (input.nodeLimits ? nearTail(nodeRemaining, input.nodeLimits) : false);
}

function coverageSaturated(input: {
  tier?: BudgetTier;
  planProgress?: { total: number; completed: number };
  coverage?: { readCallCount: number; coveredSectionCount: number };
}): boolean {
  if (!input.tier || !input.coverage || !input.planProgress) return false;
  if (input.planProgress.total === 0 || input.planProgress.completed === 0) return false;
  const readCallLimit: Record<BudgetTier, number> = { quick: 4, standard: 8, deep: 12 };
  return input.coverage.readCallCount >= readCallLimit[input.tier]
    && input.coverage.coveredSectionCount > 0;
}

function nearTail(
  remainingValue: { modelTurns: number; toolCalls: number; readCharacters: number },
  limits: { modelTurns: number; toolCalls: number; readCharacters: number },
): boolean {
  return remainingValue.modelTurns <= Math.max(1, Math.ceil(limits.modelTurns * 0.2))
    || remainingValue.toolCalls <= Math.max(1, Math.ceil(limits.toolCalls * 0.2))
    || remainingValue.readCharacters <= Math.max(200, Math.ceil(limits.readCharacters * 0.1));
}

function remaining(limit: number, used: number, reserved: number): number {
  return Math.max(0, limit - used - reserved);
}
