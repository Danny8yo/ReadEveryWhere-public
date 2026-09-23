import { BookScope, BookScopeJSON } from './book-scope';
import { BudgetUsage } from './budget';
import {
  AiReadingDomainError,
  jsonClone,
  requireIsoDate,
  requireNonEmpty,
} from './domain-error';

export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'waiting_children'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled';

export interface SubtaskResult {
  findings: Array<{ text: string; evidenceIds: string[] }>;
  evidenceIds: string[];
  openQuestions: string[];
  usage: BudgetUsage;
}

export interface AgentRunJSON {
  id: string;
  taskId: string;
  parentRunId?: string;
  depth: 0 | 1 | 2;
  goal: string;
  deliverable?: string;
  contextEvidenceIds?: string[];
  scope: BookScopeJSON;
  status: AgentRunStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  terminalReason?: string;
  result?: SubtaskResult;
}

const TERMINAL_AGENT_STATUSES: ReadonlySet<AgentRunStatus> = new Set([
  'completed',
  'partial',
  'failed',
  'cancelled',
]);

export class AgentRun {
  private statusValue: AgentRunStatus;
  private startedAtValue?: string;
  private finishedAtValue?: string;
  private terminalReasonValue?: string;
  private resultValue?: SubtaskResult;

  private constructor(
    public readonly id: string,
    public readonly taskId: string,
    public readonly parentRunId: string | undefined,
    public readonly depth: 0 | 1 | 2,
    public readonly goal: string,
    public readonly deliverable: string | undefined,
    public readonly contextEvidenceIds: string[],
    public readonly scope: BookScope,
    public readonly createdAt: string,
    status: AgentRunStatus,
    startedAt?: string,
    finishedAt?: string,
    terminalReason?: string,
    result?: SubtaskResult,
  ) {
    this.statusValue = status;
    this.startedAtValue = startedAt;
    this.finishedAtValue = finishedAt;
    this.terminalReasonValue = terminalReason;
    this.resultValue = result;
  }

  static createRoot(input: {
    id: string;
    taskId: string;
    goal: string;
    scope: BookScope;
    now: string;
  }): AgentRun {
    AgentRun.validateIdentity(input.id, input.taskId, input.goal, input.now);
    return new AgentRun(
      input.id,
      input.taskId,
      undefined,
      0,
      input.goal.trim(),
      undefined,
      [],
      input.scope,
      input.now,
      'running',
      input.now,
    );
  }

  static fromJSON(value: AgentRunJSON): AgentRun {
    AgentRun.validateIdentity(value.id, value.taskId, value.goal, value.createdAt);
    if (value.depth !== 0 && value.depth !== 1 && value.depth !== 2) {
      throw new AiReadingDomainError(
        'AGENT_RUN_STATE_INVALID',
        'agent depth must be between zero and two',
      );
    }
    if ((value.depth === 0) === Boolean(value.parentRunId)) {
      throw new AiReadingDomainError(
        'AGENT_RUN_STATE_INVALID',
        'parentRunId must exist exactly for child agents',
      );
    }
    return new AgentRun(
      value.id,
      value.taskId,
      value.parentRunId,
      value.depth,
      value.goal,
      value.deliverable,
      [...(value.contextEvidenceIds ?? [])],
      BookScope.fromJSON(value.scope),
      value.createdAt,
      value.status,
      value.startedAt,
      value.finishedAt,
      value.terminalReason,
      value.result
        ? jsonClone(value.result, 'AGENT_RUN_STATE_INVALID')
        : undefined,
    );
  }

  get status(): AgentRunStatus {
    return this.statusValue;
  }

  get terminalReason(): string | undefined {
    return this.terminalReasonValue;
  }

  get result(): SubtaskResult | undefined {
    return this.resultValue
      ? jsonClone(this.resultValue, 'AGENT_RUN_STATE_INVALID')
      : undefined;
  }

  get isActive(): boolean {
    return this.statusValue === 'queued' || this.statusValue === 'running' || this.statusValue === 'waiting_children';
  }

  createChild(input: { id: string; subgoal: string; deliverable?: string; contextEvidenceIds?: string[]; maxDepth?: 1 | 2; now: string }): AgentRun {
    if (this.depth >= (input.maxDepth ?? 1)) {
      throw new AiReadingDomainError(
        'DELEGATION_DEPTH_EXCEEDED',
        'agent has reached the maximum delegation depth',
        { parentRunId: this.id },
      );
    }
    if (this.statusValue !== 'running') {
      throw new AiReadingDomainError(
        'AGENT_RUN_TRANSITION_INVALID',
        'only a running agent can delegate',
      );
    }
    AgentRun.validateIdentity(input.id, this.taskId, input.subgoal, input.now);
    return new AgentRun(
      input.id,
      this.taskId,
      this.id,
      (this.depth + 1) as 1 | 2,
      input.subgoal.trim(),
      input.deliverable?.trim() || input.subgoal.trim(),
      [...(input.contextEvidenceIds ?? [])],
      this.scope,
      input.now,
      'queued',
    );
  }

  start(now: string): void {
    this.transitionFrom('queued', 'running', now);
    this.startedAtValue ??= now;
  }

  waitForChildren(now: string): void {
    this.transitionFrom('running', 'waiting_children', now);
  }

  resumeAfterChildren(now: string): void {
    this.transitionFrom('waiting_children', 'queued', now);
  }

  completeSubtask(result: SubtaskResult, now: string): void {
    if (this.depth === 0) {
      throw new AiReadingDomainError(
        'AGENT_RUN_ROLE_INVALID',
        'only a non-root agent can complete a subtask',
      );
    }
    this.validateSubtaskResult(result);
    this.transitionFrom('running', 'completed', now);
    this.resultValue = jsonClone(result, 'AGENT_RUN_RESULT_INVALID');
  }

  completeRoot(now: string): void {
    if (this.depth !== 0) {
      throw new AiReadingDomainError(
        'AGENT_RUN_ROLE_INVALID',
        'only the root agent can complete the task',
      );
    }
    this.transitionFrom('running', 'completed', now);
  }

  finishPartial(reason: string, now: string): void {
    requireNonEmpty(reason, 'AGENT_RUN_RESULT_INVALID', 'reason');
    if (!this.isActive) this.invalidTransition('partial');
    requireIsoDate(now, 'AGENT_RUN_STATE_INVALID', 'now');
    this.statusValue = 'partial';
    this.finishedAtValue = now;
    this.terminalReasonValue = reason;
  }

  cancel(reason: string, now: string): void {
    requireNonEmpty(reason, 'AGENT_RUN_RESULT_INVALID', 'reason');
    if (!this.isActive) this.invalidTransition('cancelled');
    requireIsoDate(now, 'AGENT_RUN_STATE_INVALID', 'now');
    this.statusValue = 'cancelled';
    this.finishedAtValue = now;
    this.terminalReasonValue = reason;
  }

  fail(errorCode: string, now: string): void {
    requireNonEmpty(errorCode, 'AGENT_RUN_RESULT_INVALID', 'errorCode');
    if (!this.isActive) this.invalidTransition('failed');
    requireIsoDate(now, 'AGENT_RUN_STATE_INVALID', 'now');
    this.statusValue = 'failed';
    this.finishedAtValue = now;
    this.terminalReasonValue = errorCode;
  }

  toJSON(): AgentRunJSON {
    return {
      id: this.id,
      taskId: this.taskId,
      parentRunId: this.parentRunId,
      depth: this.depth,
      goal: this.goal,
      deliverable: this.deliverable,
      contextEvidenceIds: [...this.contextEvidenceIds],
      scope: this.scope.toJSON(),
      status: this.statusValue,
      createdAt: this.createdAt,
      startedAt: this.startedAtValue,
      finishedAt: this.finishedAtValue,
      terminalReason: this.terminalReasonValue,
      result: this.resultValue
        ? jsonClone(this.resultValue, 'AGENT_RUN_STATE_INVALID')
        : undefined,
    };
  }

  private transitionFrom(
    expected: AgentRunStatus,
    next: AgentRunStatus,
    now: string,
  ): void {
    if (this.statusValue !== expected || TERMINAL_AGENT_STATUSES.has(this.statusValue)) {
      this.invalidTransition(next);
    }
    requireIsoDate(now, 'AGENT_RUN_STATE_INVALID', 'now');
    this.statusValue = next;
    if (TERMINAL_AGENT_STATUSES.has(next)) this.finishedAtValue = now;
  }

  private invalidTransition(next: AgentRunStatus): never {
    throw new AiReadingDomainError(
      'AGENT_RUN_TRANSITION_INVALID',
      `cannot transition agent from ${this.statusValue} to ${next}`,
      { runId: this.id, from: this.statusValue, to: next },
    );
  }

  private validateSubtaskResult(result: SubtaskResult): void {
    if (
      !Array.isArray(result.findings) ||
      !Array.isArray(result.evidenceIds) ||
      !Array.isArray(result.openQuestions)
    ) {
      throw new AiReadingDomainError(
        'AGENT_RUN_RESULT_INVALID',
        'subtask result arrays are required',
      );
    }
    for (const key of [
      'modelTurns',
      'toolCalls',
      'readCharacters',
    ] as const) {
      if (!Number.isSafeInteger(result.usage[key]) || result.usage[key] < 0) {
        throw new AiReadingDomainError(
          'AGENT_RUN_RESULT_INVALID',
          'usage must contain non-negative safe integers',
        );
      }
    }
  }

  private static validateIdentity(
    id: string,
    taskId: string,
    goal: string,
    now: string,
  ): void {
    requireNonEmpty(id, 'AGENT_RUN_INVALID', 'id');
    requireNonEmpty(taskId, 'AGENT_RUN_INVALID', 'taskId');
    requireNonEmpty(goal, 'AGENT_RUN_INVALID', 'goal');
    requireIsoDate(now, 'AGENT_RUN_INVALID', 'now');
  }
}
