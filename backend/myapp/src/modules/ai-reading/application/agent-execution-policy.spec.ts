import {
  hasIndependentUnfinishedPlanUnits,
  executionProfileForTier,
  finalizationMode,
  normalizeModelToolCalls,
} from './agent-execution-policy';

describe('agent execution policy', () => {
  it('normalizes state maintenance before one delegate and rejects ambiguous mixes', () => {
    const update = { id: 'update', name: 'update_plan', arguments: '{}' };
    const state = { id: 'state', name: 'update_reading_state', arguments: '{}' };
    const delegate = { id: 'delegate', name: 'delegate_reading', arguments: '{}' };
    const read = { id: 'read', name: 'book_read', arguments: '{}' };

    expect(normalizeModelToolCalls([delegate, update, state])).toEqual({
      calls: [update, state, delegate],
      errorCode: null,
    });
    expect(normalizeModelToolCalls([delegate, { ...delegate, id: 'delegate-2' }]).errorCode)
      .toBe('MODEL_CONTROL_TOOL_MIXED');
    expect(normalizeModelToolCalls([delegate, read]).errorCode).toBe('MODEL_CONTROL_TOOL_MIXED');
  });

  it('scales delegation depth, concurrency, and child budget with effort', () => {
    expect(executionProfileForTier('quick')).toEqual({
      maxDelegationDepth: 0,
      childLimits: null,
    });
    expect(executionProfileForTier('standard')).toEqual({
      maxDelegationDepth: 1,
      childLimits: { modelTurns: 6, toolCalls: 9, readCharacters: 32_000, executionMs: 180_000 },
    });
    expect(executionProfileForTier('deep')).toEqual({
      maxDelegationDepth: 2,
      childLimits: { modelTurns: 8, toolCalls: 12, readCharacters: 48_000, executionMs: 180_000 },
    });
  });

  it('opens delegation only for distinct unfinished plan units', () => {
    expect(hasIndependentUnfinishedPlanUnits([])).toBe(false);
    expect(hasIndependentUnfinishedPlanUnits([
      { id: 'only', description: '核验核心论证', status: 'in_progress' },
    ])).toBe(false);
    expect(hasIndependentUnfinishedPlanUnits([
      { id: 'done', description: '核对目录结构', status: 'completed' },
      { id: 'only', description: '核验核心论证', status: 'pending' },
    ])).toBe(false);
    expect(hasIndependentUnfinishedPlanUnits([
      { id: 'one', description: '核验第一章的核心论证', status: 'pending' },
      { id: 'two', description: '核验第一章的核心论证', status: 'in_progress' },
    ])).toBe(false);
    expect(hasIndependentUnfinishedPlanUnits([
      { id: 'claim', description: '核验作者提出的核心主张', status: 'in_progress' },
      { id: 'limits', description: '核验跨章节反例与限制条件', status: 'pending' },
    ])).toBe(true);
  });

  it('reserves the final model/tool turn for both root and child nodes', () => {
    const budget = {
      policy: { modelTurns: 60, toolCalls: 90, readCharacters: 250_000, delegatedAgents: 0, deadlineAt: 'later' },
      used: { modelTurns: 58, toolCalls: 88, readCharacters: 1_000, delegatedAgents: 0 },
      reserved: { modelTurns: 1, toolCalls: 0, readCharacters: 0, delegatedAgents: 0 },
    };

    expect(finalizationMode({ root: true, budget, nodeUsage: budget.used, evidenceCount: 1 })).toBe(true);
    expect(finalizationMode({ root: false, budget, nodeUsage: {
      modelTurns: 5, toolCalls: 8, readCharacters: 1_000, delegatedAgents: 0,
    }, nodeLimits: { modelTurns: 6, toolCalls: 9, readCharacters: 32_000, executionMs: 180_000 }, evidenceCount: 0 }))
      .toBe(true);
  });

  it.each([
    ['quick', 4],
    ['standard', 8],
    ['deep', 12],
  ] as const)('enters finalization after %s evidence coverage saturates at %i read calls', (tier, readCallCount) => {
    const budget = {
      policy: { modelTurns: 90, toolCalls: 135, readCharacters: 500_000, delegatedAgents: 2, deadlineAt: 'later' },
      used: { modelTurns: 12, toolCalls: 18, readCharacters: 48_000, delegatedAgents: 0 },
      reserved: { modelTurns: 0, toolCalls: 0, readCharacters: 0, delegatedAgents: 0 },
    };

    expect(finalizationMode({
      root: true,
      budget,
      nodeUsage: budget.used,
      evidenceCount: 8,
      planComplete: false,
      tier,
      coverage: { readCallCount, coveredSectionCount: 3 },
      planProgress: { total: 2, completed: 1 },
    })).toBe(true);
  });

  it('does not finalize from dense evidence before bounded coverage is saturated', () => {
    const budget = {
      policy: { modelTurns: 90, toolCalls: 135, readCharacters: 500_000, delegatedAgents: 2, deadlineAt: 'later' },
      used: { modelTurns: 10, toolCalls: 15, readCharacters: 100_000, delegatedAgents: 0 },
      reserved: { modelTurns: 0, toolCalls: 0, readCharacters: 0, delegatedAgents: 0 },
    };

    expect(finalizationMode({
      root: true,
      budget,
      nodeUsage: budget.used,
      evidenceCount: 40,
      planComplete: false,
      tier: 'standard',
      coverage: { readCallCount: 7, coveredSectionCount: 1 },
      planProgress: { total: 2, completed: 1 },
    })).toBe(false);
  });
});
