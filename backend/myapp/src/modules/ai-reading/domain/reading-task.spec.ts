import { BookScope } from './book-scope';
import type { BudgetPolicyInput } from './budget';
import { EvidenceLedger } from './evidence-ledger';
import { ReadingTask, ReadingTaskResult } from './reading-task';

const NOW = '2026-08-06T00:00:00.000Z';
const LATER = '2026-08-06T00:00:01.000Z';
const scope = BookScope.create({
  userId: 'user-1',
  bookId: 'book-1',
  contentRevision: 'rev-1',
});

function createTask(
  tier: 'quick' | 'standard' | 'deep' = 'standard',
  budgetPolicy?: BudgetPolicyInput,
) {
  return ReadingTask.create({
    id: 'task-1',
    userId: 'user-1',
    goal: 'Explain how the argument develops.',
    scope,
    budgetTier: tier,
    budgetPolicy,
    now: NOW,
  });
}

const customPolicy: BudgetPolicyInput = {
  maxModelTurns: 120,
  maxToolCalls: 180,
  maxReadCharacters: 1_000_000,
  maxDurationMs: 60 * 60_000,
  maxDelegatedAgents: 9,
  maxConcurrentAgents: 3,
};

function evidenceLedger() {
  const ledger = EvidenceLedger.create('task-1', scope);
  ledger.recordBookRead({
    evidenceId: 'evidence-1',
    taskId: 'task-1',
    agentRunId: 'child-1',
    scope,
    quote: 'supported claim',
    bookRead: {
      text: 'A supported claim appears in this passage.',
      citation: {
        bookId: 'book-1',
        contentRevision: 'rev-1',
        locator: {
          version: 1,
          position: {
            kind: 'epub_text',
            sectionIndex: 1,
            start: 2,
            end: 17,
          },
          textQuote: { exact: 'supported claim' },
        },
      },
    },
    createdAt: NOW,
  });
  return ledger;
}

function validResult(): ReadingTaskResult {
  return {
    summary: 'A grounded summary.',
    bookFindings: [{ text: 'Claim', evidenceIds: ['evidence-1'] }],
    inferences: [],
    backgroundKnowledge: [],
    openQuestions: [],
    limitations: [],
  };
}

describe('ReadingTask and AgentRun state machines', () => {
  it('stores a cloned custom budget snapshot and mode at creation', () => {
    const input = { ...customPolicy };
    const task = ReadingTask.create({
      id: 'task-1',
      userId: 'user-1',
      goal: 'Read broadly.',
      scope,
      budgetTier: 'standard',
      budgetPolicy: input,
      now: NOW,
    });
    input.maxModelTurns = 3;

    expect(task.budgetMode).toBe('custom');
    expect(task.toJSON()).toMatchObject({
      budgetTier: 'standard',
      budgetMode: 'custom',
      budget: { policy: { tier: 'standard', maxModelTurns: 120 } },
    });
  });

  it('restores legacy task JSON without budgetMode as a preset task', () => {
    const value = createTask('quick').toJSON();
    delete value.budgetMode;

    const restored = ReadingTask.fromJSON(value);

    expect(restored.budgetMode).toBe('preset');
    expect(restored.toJSON().budgetMode).toBe('preset');
  });

  it('keeps an explicitly custom mode even when values equal the template', () => {
    const task = ReadingTask.create({
      id: 'task-1',
      userId: 'user-1',
      goal: 'Read with explicit limits.',
      scope,
      budgetTier: 'quick',
      budgetPolicy: {
        maxModelTurns: 10,
        maxToolCalls: 15,
        maxReadCharacters: 30_000,
        maxDurationMs: 3 * 60_000,
        maxDelegatedAgents: 1,
        maxConcurrentAgents: 1,
      },
      now: NOW,
    });

    expect(ReadingTask.fromJSON(task.toJSON()).budgetMode).toBe('custom');
  });

  it('keeps the aggregate queued when root-agent creation is rejected', () => {
    const task = createTask();

    expect(() => task.start('', LATER)).toThrow('AGENT_RUN_INVALID');
    expect(task.status).toBe('queued');
    expect(task.listRuns()).toHaveLength(0);
  });

  it('allows only legal task transitions', () => {
    const task = createTask();
    expect(task.status).toBe('queued');
    expect(() => task.complete(validResult(), evidenceLedger(), LATER)).toThrow(
      'TASK_TRANSITION_INVALID',
    );

    const root = task.start('root-1', LATER);
    expect(task.status).toBe('running');
    expect(root.status).toBe('running');

    task.complete(validResult(), evidenceLedger(), LATER);
    expect(task.status).toBe('completed');
    expect(root.status).toBe('completed');
    expect(() => task.cancel('too late', LATER)).toThrow(
      'TASK_TRANSITION_INVALID',
    );
  });

  it('counts duration from agent start and freezes terminal usage across recovery', () => {
    const task = createTask('quick');
    const queuedLater = '2026-08-06T00:10:00.000Z';
    expect(task.budgetSnapshot(queuedLater).elapsedMs).toBe(0);

    task.start('root-1', queuedLater);
    expect(task.budgetSnapshot('2026-08-06T00:10:05.000Z').elapsedMs).toBe(5_000);

    task.fail('TEST_TERMINAL', '2026-08-06T00:10:10.000Z');
    const restored = ReadingTask.fromJSON(task.toJSON());
    expect(restored.budgetSnapshot('2026-08-06T01:10:10.000Z').elapsedMs).toBe(10_000);
    expect(restored.budgetSnapshot('2026-08-06T01:10:10.000Z').exhaustedBy).not.toContain('duration');
  });

  it('allows queued/running cancellation, cascades it, and never labels it partial', () => {
    const queued = createTask();
    queued.cancel('user requested', LATER);
    expect(queued.status).toBe('cancelled');
    expect(queued.result).toBeUndefined();
    expect(ReadingTask.fromJSON(queued.toJSON()).status).toBe('cancelled');

    const running = createTask('deep');
    const root = running.start('root-1', LATER);
    const child = running.delegate({
      parentRunId: root.id,
      runId: 'child-1',
      subgoal: 'Read chapter one',
      now: LATER,
    });
    child.start(LATER);

    running.cancel('user requested', LATER);

    expect(running.status).toBe('cancelled');
    expect(root.status).toBe('cancelled');
    expect(child.status).toBe('cancelled');
  });

  it('finishes as immutable needs_input with a public clarification question', () => {
    const task = createTask();
    const root = task.start('root-1', LATER);

    task.requestInput('你说的“这一章”是第三章还是第四章？', LATER);

    expect(task.toJSON()).toMatchObject({
      status: 'needs_input',
      clarificationQuestion: '你说的“这一章”是第三章还是第四章？',
    });
    expect(root.status).toBe('completed');
    expect(() => task.start('root-2', LATER)).toThrow('TASK_TRANSITION_INVALID');
  });

  it('enforces one delegation per parent and the per-parent width limit', () => {
    const task = createTask('deep');
    const root = task.start('root-1', LATER);
    const children = task.delegateBatch([
      { parentRunId: root.id, runId: 'child-1', subgoal: 'Analyze the central argument and its supporting evidence',
        deliverable: 'Return the argument and cited evidence', now: LATER },
      { parentRunId: root.id, runId: 'child-2', subgoal: 'Find counterexamples that weaken the author conclusion',
        deliverable: 'Return counterexamples and their implications', now: LATER },
      { parentRunId: root.id, runId: 'child-3', subgoal: 'Map how the chapter sequence changes the thesis over time',
        deliverable: 'Return a chapter progression summary', now: LATER },
    ]);

    expect(() =>
      task.delegate({
        parentRunId: root.id,
        runId: 'child-4',
        subgoal: 'Analyze another independent branch after the first batch',
        deliverable: 'Return another structured branch result',
        now: LATER,
      }),
    ).toThrow('DELEGATION_ALREADY_PERFORMED');

    children[0].start(LATER);
    expect(task.delegateBatch([{ parentRunId: children[0].id, runId: 'grandchild',
      subgoal: 'Verify the strongest cited example in the assigned branch',
      deliverable: 'Return a verified example and evidence', now: LATER }])[0].depth).toBe(2);
  });

  it('never exceeds the tier total even after earlier children finish', () => {
    const task = createTask('deep');
    const root = task.start('root-1', LATER);
    const subtaskResult = {
      findings: [],
      evidenceIds: [],
      openQuestions: [],
      usage: { modelTurns: 1, toolCalls: 0, readCharacters: 0 },
    };

    const children = task.delegateBatch([
      { parentRunId: root.id, runId: 'child-1', subgoal: 'Trace the main thesis across the opening chapters',
        deliverable: 'Return thesis changes with evidence', now: LATER },
      { parentRunId: root.id, runId: 'child-2', subgoal: 'Evaluate the strongest objections presented by the author',
        deliverable: 'Return objections and responses', now: LATER },
      { parentRunId: root.id, runId: 'child-3', subgoal: 'Inspect the conclusion for unsupported causal claims',
        deliverable: 'Return causal gaps and citations', now: LATER },
    ]);
    children[0].start(LATER);
    task.delegateBatch([
      { parentRunId: children[0].id, runId: 'child-4', subgoal: 'Verify the opening definition used to establish the thesis',
        deliverable: 'Return the definition and exact evidence', now: LATER },
      { parentRunId: children[0].id, runId: 'child-5', subgoal: 'Compare the middle chapter evidence with the initial claim',
        deliverable: 'Return comparison findings and citations', now: LATER },
      { parentRunId: children[0].id, runId: 'child-6', subgoal: 'Check whether the final chapter revises the original thesis',
        deliverable: 'Return revisions and supporting passages', now: LATER },
    ]);

    expect(() =>
      task.delegate({
        parentRunId: children[1].id,
        runId: 'child-7',
        subgoal: 'Verify one more detailed evidence branch beyond the limit',
        deliverable: 'Return the extra verified evidence branch',
        now: LATER,
      }),
    ).toThrow('DELEGATION_LAYER_EXCEEDED');
  });

  it('rejects an over-limit delegation batch without creating partial child state', () => {
    const task = createTask('quick', {
      maxModelTurns: 10,
      maxToolCalls: 15,
      maxReadCharacters: 30_000,
      maxDurationMs: 3 * 60_000,
      maxDelegatedAgents: 1,
      maxConcurrentAgents: 1,
    });
    const root = task.start('root-1', LATER);

    expect(() => task.delegateBatch([
      {
        parentRunId: root.id,
        runId: 'child-1',
        subgoal: 'Analyze the first independent evidence branch fully',
        deliverable: 'Return findings for the first branch',
        now: LATER,
      },
      {
        parentRunId: root.id,
        runId: 'child-2',
        subgoal: 'Analyze the second independent evidence branch fully',
        deliverable: 'Return findings for the second branch',
        now: LATER,
      },
    ])).toThrow('DELEGATION_TOTAL_EXCEEDED');

    expect(task.listRuns().filter((run) => run.depth === 1)).toHaveLength(0);
  });

  it('allows one controlled depth-two delegation and rejects a second delegation by the same parent', () => {
    const task = createTask('deep');
    const root = task.start('root-recursive', LATER);
    const [child] = task.delegateBatch([{
      parentRunId: root.id,
      runId: 'child-recursive',
      subgoal: '分析第一章中作者提出的核心判断依据',
      deliverable: '返回判断、证据和未决问题',
      contextEvidenceIds: [],
      now: LATER,
    }]);
    child.start(LATER);

    expect(task.delegateBatch([{
      parentRunId: child.id,
      runId: 'grandchild-recursive',
      subgoal: '核对第一章案例对核心判断的支持程度',
      deliverable: '返回案例证据和支持强度',
      contextEvidenceIds: [],
      now: LATER,
    }])[0].depth).toBe(2);

    expect(() => task.delegateBatch([{
      parentRunId: child.id,
      runId: 'grandchild-recursive-2',
      subgoal: '梳理第一章其余案例对核心判断的补充作用',
      deliverable: '返回补充案例和证据列表',
      contextEvidenceIds: [],
      now: LATER,
    }])).toThrow('DELEGATION_ALREADY_PERFORMED');
  });

  it('uses partial only for a budget-limited result backed by owned evidence', () => {
    const task = createTask();
    task.start('root-1', LATER);

    expect(() =>
      task.finishBudgetLimited(
        {
          ...validResult(),
          bookFindings: [{ text: 'Claim', evidenceIds: ['foreign'] }],
        },
        evidenceLedger(),
        LATER,
      ),
    ).toThrow('EVIDENCE_NOT_OWNED');

    task.finishBudgetLimited(validResult(), evidenceLedger(), LATER);
    expect(task.status).toBe('partial');
    expect(task.terminalReason).toBe('budget_exhausted');
  });

  it('keeps the explicit stop reason for any evidence-backed partial result', () => {
    const task = createTask();
    task.start('root-1', LATER);

    task.finishPartial(validResult(), evidenceLedger(), 'DEEPSEEK_TIMEOUT', LATER);

    expect(task.status).toBe('partial');
    expect(task.terminalReason).toBe('DEEPSEEK_TIMEOUT');
  });

  it('does not mark a task completed without any grounded book evidence', () => {
    const task = createTask();
    task.start('root-1', LATER);

    expect(() => task.complete({
      summary: 'Reading task completed.',
      bookFindings: [],
      inferences: [],
      backgroundKnowledge: [],
      openQuestions: [],
      limitations: [],
    }, evidenceLedger(), LATER)).toThrow('READING_RESULT_EVIDENCE_REQUIRED');
    expect(task.status).toBe('running');
  });

  it('round-trips the aggregate, runs and budget through plain JSON', () => {
    const task = createTask('deep');
    const root = task.start('root-1', LATER);
    task.updatePlan(
      [
        { id: 'step-1', description: 'Inspect structure', status: 'completed' },
        { id: 'step-2', description: 'Read evidence', status: 'in_progress' },
      ],
      LATER,
    );
    task.delegate({
      parentRunId: root.id,
      runId: 'child-1',
      subgoal: 'Read evidence',
      now: LATER,
    });

    const restored = ReadingTask.fromJSON(task.toJSON());

    expect(restored.toJSON()).toEqual(task.toJSON());
    expect(restored.getRun('child-1')?.scope.equals(scope)).toBe(true);
  });
});
