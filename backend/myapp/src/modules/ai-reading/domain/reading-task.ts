import { AgentRun, AgentRunJSON } from './agent-run';
import { BookScope, BookScopeJSON } from './book-scope';
import {
  BudgetLedger,
  BudgetLedgerJSON,
  BudgetMode,
  BudgetPolicyInput,
  BudgetSnapshot,
  BudgetTier,
  resolveBudgetPolicy,
} from './budget';
import {
  AiReadingDomainError,
  jsonClone,
  requireIsoDate,
  requireNonEmpty,
} from './domain-error';
import { EvidenceLedger } from './evidence-ledger';
import {
  DEFAULT_RECURSIVE_DELEGATION_POLICY,
  LEGACY_DELEGATION_POLICY,
  RecursiveDelegationPolicy,
  RecursiveDelegationPolicyJSON,
} from './recursive-delegation.policy';

export type ReadingTaskStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'partial'
  | 'needs_input'
  | 'failed'
  | 'cancelled';

export type ReadingPlanStepStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed';

export interface ReadingPlanStep {
  id: string;
  description: string;
  status: ReadingPlanStepStatus;
}

export interface GroundedStatement {
  text: string;
  evidenceIds: string[];
}

export interface ReadingTaskResult {
  summary: string;
  answerText?: string;
  bookFindings: GroundedStatement[];
  inferences: GroundedStatement[];
  backgroundKnowledge: Array<{ text: string }>;
  openQuestions: string[];
  limitations: string[];
}

export interface TrustedBookAnalysisContext {
  profileId: string;
  primaryGenre: string;
  secondaryGenres: string[];
  traits: string[];
  confidence:
    | number
    | { kind: 'ai-score'; score: number }
    | { kind: 'user-determined' };
  classificationSummary: string | null;
  profileVersion?: number;
  contentRevision: {
    fileChecksum: string;
    extractorVersion: string;
    normalizationVersion: string;
  };
  modelId?: string;
  strategyVersion?: string;
  analyzedAt?: string;
  updatedAt?: string;
  spoilerPolicy: 'avoid_unless_user_requests';
}

export interface ReadingTaskJSON {
  id: string;
  userId: string;
  goal: string;
  scope: BookScopeJSON;
  budgetTier: BudgetTier;
  budgetMode?: BudgetMode;
  status: ReadingTaskStatus;
  plan: ReadingPlanStep[];
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  terminalReason?: string;
  clarificationQuestion?: string;
  result?: ReadingTaskResult;
  bookAnalysis?: TrustedBookAnalysisContext;
  runs: AgentRunJSON[];
  budget: BudgetLedgerJSON;
  delegationPolicy?: RecursiveDelegationPolicyJSON;
}

const TERMINAL_TASK_STATUSES: ReadonlySet<ReadingTaskStatus> = new Set([
  'completed',
  'partial',
  'needs_input',
  'failed',
  'cancelled',
]);

export class ReadingTask {
  private statusValue: ReadingTaskStatus;
  private planValue: ReadingPlanStep[];
  private updatedAtValue: string;
  private finishedAtValue?: string;
  private terminalReasonValue?: string;
  private resultValue?: ReadingTaskResult;
  private clarificationQuestionValue?: string;
  private readonly runs = new Map<string, AgentRun>();

  private constructor(
    public readonly id: string,
    public readonly userId: string,
    public readonly goal: string,
    public readonly scope: BookScope,
    public readonly budgetTier: BudgetTier,
    public readonly budgetMode: BudgetMode,
    public readonly createdAt: string,
    public readonly budget: BudgetLedger,
    public readonly delegationPolicy: RecursiveDelegationPolicy,
    private readonly bookAnalysisValue: TrustedBookAnalysisContext | undefined,
    status: ReadingTaskStatus,
    plan: ReadingPlanStep[],
    updatedAt: string,
    finishedAt?: string,
    terminalReason?: string,
    result?: ReadingTaskResult,
    clarificationQuestion?: string,
  ) {
    this.statusValue = status;
    this.planValue = plan;
    this.updatedAtValue = updatedAt;
    this.finishedAtValue = finishedAt;
    this.terminalReasonValue = terminalReason;
    this.resultValue = result;
    this.clarificationQuestionValue = clarificationQuestion;
  }

  static create(input: {
    id: string;
    userId: string;
    goal: string;
    scope: BookScope;
    budgetTier: BudgetTier;
    budgetPolicy?: BudgetPolicyInput;
    bookAnalysis?: TrustedBookAnalysisContext;
    delegationPolicy?: RecursiveDelegationPolicyJSON;
    now: string;
  }): ReadingTask {
    requireNonEmpty(input.id, 'READING_TASK_INVALID', 'id');
    requireNonEmpty(input.userId, 'READING_TASK_INVALID', 'userId');
    requireNonEmpty(input.goal, 'READING_TASK_INVALID', 'goal');
    requireIsoDate(input.now, 'READING_TASK_INVALID', 'now');
    if (input.userId !== input.scope.userId) {
      throw new AiReadingDomainError(
        'READING_TASK_SCOPE_MISMATCH',
        'task owner must equal the trusted book scope owner',
      );
    }
    const policy = resolveBudgetPolicy(input.budgetTier, input.budgetPolicy);
    return new ReadingTask(
      input.id,
      input.userId,
      input.goal.trim(),
      input.scope,
      input.budgetTier,
      input.budgetPolicy ? 'custom' : 'preset',
      input.now,
      BudgetLedger.create(policy, input.now),
      new RecursiveDelegationPolicy(input.delegationPolicy ?? DEFAULT_RECURSIVE_DELEGATION_POLICY),
      cloneBookAnalysis(input.bookAnalysis),
      'queued',
      [],
      input.now,
    );
  }

  static fromJSON(value: ReadingTaskJSON): ReadingTask {
    const scope = BookScope.fromJSON(value.scope);
    const budgetMode = value.budgetMode ?? 'preset';
    if (budgetMode !== 'preset' && budgetMode !== 'custom') {
      throw new AiReadingDomainError(
        'READING_TASK_STATE_INVALID',
        'persisted budget mode is invalid',
      );
    }
    const task = new ReadingTask(
      value.id,
      value.userId,
      value.goal,
      scope,
      value.budgetTier,
      budgetMode,
      value.createdAt,
      BudgetLedger.fromJSON(value.budget),
      new RecursiveDelegationPolicy(value.delegationPolicy ?? LEGACY_DELEGATION_POLICY),
      cloneBookAnalysis(value.bookAnalysis),
      value.status,
      ReadingTask.validatePlan(value.plan),
      value.updatedAt,
      value.finishedAt,
      value.terminalReason,
      value.result
        ? jsonClone(value.result, 'READING_TASK_STATE_INVALID')
        : undefined,
      value.clarificationQuestion,
    );
    requireNonEmpty(value.id, 'READING_TASK_STATE_INVALID', 'id');
    requireNonEmpty(value.userId, 'READING_TASK_STATE_INVALID', 'userId');
    requireNonEmpty(value.goal, 'READING_TASK_STATE_INVALID', 'goal');
    requireIsoDate(
      value.createdAt,
      'READING_TASK_STATE_INVALID',
      'createdAt',
    );
    requireIsoDate(
      value.updatedAt,
      'READING_TASK_STATE_INVALID',
      'updatedAt',
    );
    if (
      value.userId !== scope.userId ||
      value.budget.policy.tier !== value.budgetTier
    ) {
      throw new AiReadingDomainError(
        'READING_TASK_STATE_INVALID',
        'persisted task scope or budget tier is inconsistent',
      );
    }
    for (const rawRun of value.runs) {
      const run = AgentRun.fromJSON(rawRun);
      if (
        run.taskId !== task.id ||
        !run.scope.equals(task.scope) ||
        task.runs.has(run.id)
      ) {
        throw new AiReadingDomainError(
          'READING_TASK_STATE_INVALID',
          'persisted agent run violates the task boundary',
        );
      }
      task.runs.set(run.id, run);
    }
    task.assertRunTopology();
    return task;
  }

  get status(): ReadingTaskStatus {
    return this.statusValue;
  }

  get plan(): ReadingPlanStep[] {
    return jsonClone(this.planValue, 'READING_TASK_STATE_INVALID');
  }

  get result(): ReadingTaskResult | undefined {
    return this.resultValue
      ? jsonClone(this.resultValue, 'READING_TASK_STATE_INVALID')
      : undefined;
  }

  get terminalReason(): string | undefined {
    return this.terminalReasonValue;
  }

  get clarificationQuestion(): string | undefined {
    return this.clarificationQuestionValue;
  }

  get bookAnalysis(): TrustedBookAnalysisContext | undefined {
    return cloneBookAnalysis(this.bookAnalysisValue);
  }

  budgetSnapshot(now: string): BudgetSnapshot {
    if (this.statusValue === 'queued') return this.budget.snapshot(this.budget.startedAt);
    return this.budget.snapshot(this.finishedAtValue ?? now);
  }

  start(rootRunId: string, now: string): AgentRun {
    if (this.statusValue !== 'queued') this.invalidTransition('running');
    if (this.runs.size > 0) {
      throw new AiReadingDomainError(
        'READING_TASK_STATE_INVALID',
        'a queued task cannot already contain agent runs',
      );
    }
    const root = AgentRun.createRoot({
      id: rootRunId,
      taskId: this.id,
      goal: this.goal,
      scope: this.scope,
      now,
    });
    this.budget.startExecution(now);
    this.transitionFrom('queued', 'running', now);
    this.runs.set(root.id, root);
    return root;
  }

  updatePlan(steps: ReadingPlanStep[], now: string): void {
    this.requireRunning();
    requireIsoDate(now, 'READING_TASK_INVALID', 'now');
    this.planValue = ReadingTask.validatePlan(steps);
    this.updatedAtValue = now;
  }

  delegate(input: {
    parentRunId: string;
    runId: string;
    subgoal: string;
    deliverable?: string;
    contextEvidenceIds?: string[];
    now: string;
  }): AgentRun {
    return this.delegateBatch([input])[0];
  }

  delegateBatch(inputs: Array<{
    parentRunId: string;
    runId: string;
    subgoal: string;
    deliverable?: string;
    contextEvidenceIds?: string[];
    now: string;
  }>): AgentRun[] {
    this.requireRunning();
    if (inputs.length === 0) {
      throw new AiReadingDomainError(
        'DELEGATION_BATCH_INVALID',
        'delegation batch cannot be empty',
      );
    }
    const parentRunIds = new Set(inputs.map((input) => input.parentRunId));
    if (parentRunIds.size !== 1) {
      throw new AiReadingDomainError(
        'DELEGATION_PARENT_MISMATCH',
        'all children in a delegation batch must share one parent',
      );
    }
    const parent = this.runs.get(inputs[0].parentRunId);
    if (!parent) {
      throw new AiReadingDomainError(
        'DELEGATION_PARENT_NOT_FOUND',
        'parent agent does not belong to this task',
      );
    }
    const childDepth = parent.depth + 1;
    this.delegationPolicy.assertDepth(parent.depth, childDepth);
    const runIds = inputs.map((input) => input.runId);
    if (new Set(runIds).size !== runIds.length || runIds.some((runId) => this.runs.has(runId))) {
      throw new AiReadingDomainError(
        'AGENT_RUN_ID_CONFLICT',
        'agent run id already exists in this task',
      );
    }
    const directChildren = [...this.runs.values()].filter((run) => run.parentRunId === parent.id);
    this.delegationPolicy.assertParentCapacity(directChildren.length, inputs.length);
    const layerChildren = [...this.runs.values()].filter((run) => run.depth === childDepth);
    this.delegationPolicy.assertLayerCapacity(layerChildren.length, inputs.length);
    const ancestorGoals: string[] = [];
    let ancestor: AgentRun | undefined = parent;
    while (ancestor) {
      ancestorGoals.push(ancestor.goal);
      ancestor = ancestor.parentRunId ? this.runs.get(ancestor.parentRunId) : undefined;
    }
    this.delegationPolicy.validateSubtasks(
      inputs.map((input) => ({
        goal: input.subgoal,
        deliverable: input.deliverable ?? legacyDeliverable(input.subgoal),
      })),
      ancestorGoals,
      [...this.runs.values()].map((run) => run.goal),
    );
    const delegated = [...this.runs.values()].filter((run) => run.depth > 0);
    if (delegated.length + inputs.length > this.budget.policy.maxDelegatedAgents) {
      throw new AiReadingDomainError(
        'DELEGATION_TOTAL_EXCEEDED',
        'task has reached its total child-agent limit',
      );
    }
    const candidates = inputs.map((input) => parent.createChild({
      id: input.runId,
      subgoal: input.subgoal,
      deliverable: input.deliverable ?? legacyDeliverable(input.subgoal),
      contextEvidenceIds: input.contextEvidenceIds ?? [],
      maxDepth: this.delegationPolicy.value.maxDepth,
      now: input.now,
    }));
    for (const child of candidates) this.runs.set(child.id, child);
    this.updatedAtValue = inputs[inputs.length - 1].now;
    return candidates;
  }

  complete(
    result: ReadingTaskResult,
    evidence: EvidenceLedger,
    now: string,
  ): void {
    this.requireRunning();
    this.assertNoActiveChildren();
    this.validateResult(result, evidence, false);
    this.rootRun().completeRoot(now);
    this.finish('completed', result, undefined, now);
  }

  finishBudgetLimited(
    result: ReadingTaskResult,
    evidence: EvidenceLedger,
    now: string,
  ): void {
    this.finishPartial(result, evidence, 'budget_exhausted', now);
  }

  finishPartial(
    result: ReadingTaskResult,
    evidence: EvidenceLedger,
    reasonCode: string,
    now: string,
  ): void {
    this.requireRunning();
    requireNonEmpty(reasonCode, 'READING_TASK_INVALID', 'reasonCode');
    const evidenceCount = this.validateResult(result, evidence, true);
    if (evidenceCount === 0) {
      throw new AiReadingDomainError(
        'PARTIAL_RESULT_REQUIRES_EVIDENCE',
        'a partial result requires at least one owned evidence reference',
      );
    }
    for (const run of this.runs.values()) {
      if (run.isActive) run.finishPartial(reasonCode, now);
    }
    this.finish('partial', result, reasonCode, now);
  }

  requestInput(question: string, now: string): void {
    this.requireRunning();
    this.assertNoActiveChildren();
    requireNonEmpty(question, 'READING_TASK_INVALID', 'question');
    this.rootRun().completeRoot(now);
    this.clarificationQuestionValue = question.trim();
    this.finish('needs_input', undefined, 'reference_unresolved', now);
  }

  cancel(reason: string, now: string): void {
    requireNonEmpty(reason, 'READING_TASK_INVALID', 'reason');
    if (this.statusValue !== 'queued' && this.statusValue !== 'running') {
      this.invalidTransition('cancelled');
    }
    requireIsoDate(now, 'READING_TASK_INVALID', 'now');
    for (const run of this.runs.values()) {
      if (run.isActive) run.cancel(reason, now);
    }
    this.finish('cancelled', undefined, reason, now);
  }

  fail(errorCode: string, now: string): void {
    requireNonEmpty(errorCode, 'READING_TASK_INVALID', 'errorCode');
    if (this.statusValue !== 'queued' && this.statusValue !== 'running') {
      this.invalidTransition('failed');
    }
    requireIsoDate(now, 'READING_TASK_INVALID', 'now');
    for (const run of this.runs.values()) {
      if (run.isActive) run.fail(errorCode, now);
    }
    this.finish('failed', undefined, errorCode, now);
  }

  getRun(runId: string): AgentRun | undefined {
    return this.runs.get(runId);
  }

  listRuns(): AgentRun[] {
    return [...this.runs.values()];
  }

  toJSON(): ReadingTaskJSON {
    return {
      id: this.id,
      userId: this.userId,
      goal: this.goal,
      scope: this.scope.toJSON(),
      budgetTier: this.budgetTier,
      budgetMode: this.budgetMode,
      status: this.statusValue,
      plan: this.plan,
      createdAt: this.createdAt,
      updatedAt: this.updatedAtValue,
      finishedAt: this.finishedAtValue,
      terminalReason: this.terminalReasonValue,
      clarificationQuestion: this.clarificationQuestionValue,
      result: this.result,
      ...(this.bookAnalysisValue ? { bookAnalysis: this.bookAnalysis } : {}),
      runs: [...this.runs.values()].map((run) => run.toJSON()),
      budget: this.budget.toJSON(),
      delegationPolicy: this.delegationPolicy.value,
    };
  }

  private validateResult(
    result: ReadingTaskResult,
    evidence: EvidenceLedger,
    partial: boolean,
  ): number {
    evidence.assertBoundTo(this.id, this.scope);
    requireNonEmpty(result.summary, 'READING_RESULT_INVALID', 'summary');
    if (result.answerText !== undefined && (
      typeof result.answerText !== 'string'
      || result.answerText.trim().length === 0
      || result.answerText.length > 8_000
    )) {
      throw new AiReadingDomainError(
        'READING_RESULT_INVALID',
        'answerText must be a non-empty string of at most 8000 characters',
      );
    }
    if (
      !Array.isArray(result.bookFindings) ||
      !Array.isArray(result.inferences) ||
      !Array.isArray(result.backgroundKnowledge) ||
      !Array.isArray(result.openQuestions) ||
      !Array.isArray(result.limitations)
    ) {
      throw new AiReadingDomainError(
        'READING_RESULT_INVALID',
        'result categories must be arrays',
      );
    }
    const evidenceIds: string[] = [];
    for (const statement of [...result.bookFindings, ...result.inferences]) {
      requireNonEmpty(statement.text, 'READING_RESULT_INVALID', 'statement.text');
      if (!Array.isArray(statement.evidenceIds) || statement.evidenceIds.length === 0) {
        throw new AiReadingDomainError(
          'READING_RESULT_EVIDENCE_REQUIRED',
          'book findings and evidence-based inferences require evidence',
        );
      }
      evidenceIds.push(...statement.evidenceIds);
    }
    evidence.requireOwned(evidenceIds);
    if (evidenceIds.length === 0) {
      throw new AiReadingDomainError(
        'READING_RESULT_EVIDENCE_REQUIRED',
        partial
          ? 'a partial result requires at least one grounded finding'
          : 'a completed result requires at least one grounded finding',
      );
    }
    return evidenceIds.length;
  }

  private finish(
    status: Extract<
      ReadingTaskStatus,
      'completed' | 'partial' | 'needs_input' | 'failed' | 'cancelled'
    >,
    result: ReadingTaskResult | undefined,
    reason: string | undefined,
    now: string,
  ): void {
    this.statusValue = status;
    this.resultValue = result
      ? jsonClone(result, 'READING_RESULT_INVALID')
      : undefined;
    this.terminalReasonValue = reason;
    this.finishedAtValue = now;
    this.updatedAtValue = now;
  }

  private transitionFrom(
    expected: ReadingTaskStatus,
    next: ReadingTaskStatus,
    now: string,
  ): void {
    if (this.statusValue !== expected || TERMINAL_TASK_STATUSES.has(this.statusValue)) {
      this.invalidTransition(next);
    }
    requireIsoDate(now, 'READING_TASK_INVALID', 'now');
    this.statusValue = next;
    this.updatedAtValue = now;
  }

  private invalidTransition(next: ReadingTaskStatus): never {
    throw new AiReadingDomainError(
      'TASK_TRANSITION_INVALID',
      `cannot transition task from ${this.statusValue} to ${next}`,
      { taskId: this.id, from: this.statusValue, to: next },
    );
  }

  private requireRunning(): void {
    if (this.statusValue !== 'running') this.invalidTransition('running');
  }

  private rootRun(): AgentRun {
    const roots = [...this.runs.values()].filter((run) => run.depth === 0);
    if (roots.length !== 1) {
      throw new AiReadingDomainError(
        'READING_TASK_STATE_INVALID',
        'a running task must have exactly one root agent',
      );
    }
    return roots[0];
  }

  private assertNoActiveChildren(): void {
    if ([...this.runs.values()].some((run) => run.depth > 0 && run.isActive)) {
      throw new AiReadingDomainError(
        'TASK_CHILDREN_ACTIVE',
        'the root agent cannot complete while child agents are active',
      );
    }
  }

  private assertRunTopology(): void {
    const roots = [...this.runs.values()].filter((run) => run.depth === 0);
    if (this.statusValue === 'queued' && this.runs.size !== 0) {
      throw new AiReadingDomainError(
        'READING_TASK_STATE_INVALID',
        'queued tasks cannot contain agent runs',
      );
    }
    const canBeTerminalWithoutRuns =
      (this.statusValue === 'failed' || this.statusValue === 'cancelled') &&
      this.runs.size === 0;
    if (this.statusValue !== 'queued' && roots.length !== 1 && !canBeTerminalWithoutRuns) {
      throw new AiReadingDomainError(
        'READING_TASK_STATE_INVALID',
        'started tasks require exactly one root agent',
      );
    }
    if ([...this.runs.values()].some((run) => {
      if (run.depth === 0) return Boolean(run.parentRunId);
      const parent = run.parentRunId ? this.runs.get(run.parentRunId) : undefined;
      return !parent || parent.depth + 1 !== run.depth;
    })) {
      throw new AiReadingDomainError(
        'READING_TASK_STATE_INVALID',
        'agent tree contains an invalid parent or depth',
      );
    }
  }

  private static validatePlan(steps: ReadingPlanStep[]): ReadingPlanStep[] {
    if (!Array.isArray(steps)) {
      throw new AiReadingDomainError(
        'READING_PLAN_INVALID',
        'plan must be an array',
      );
    }
    const ids = new Set<string>();
    for (const step of steps) {
      requireNonEmpty(step.id, 'READING_PLAN_INVALID', 'step.id');
      requireNonEmpty(
        step.description,
        'READING_PLAN_INVALID',
        'step.description',
      );
      if (
        !['pending', 'in_progress', 'completed', 'failed'].includes(step.status) ||
        ids.has(step.id)
      ) {
        throw new AiReadingDomainError(
          'READING_PLAN_INVALID',
          'plan step ids must be unique and statuses valid',
        );
      }
      ids.add(step.id);
    }
    return jsonClone(steps, 'READING_PLAN_INVALID');
  }
}

function legacyDeliverable(goal: string): string {
  return goal.trim().length >= 8 ? goal.trim() : `${goal.trim()} result`;
}

function cloneBookAnalysis(
  value: TrustedBookAnalysisContext | undefined,
): TrustedBookAnalysisContext | undefined {
  return value ? jsonClone(value, 'READING_TASK_STATE_INVALID') : undefined;
}
