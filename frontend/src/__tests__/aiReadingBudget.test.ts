import { describe, expect, it } from 'vitest';
import {
  budgetPolicyForRequest,
  budgetValueForInput,
  createBudgetSelection,
  customizeBudgetPolicy,
  policyValueFromInput,
  selectCustomBudget,
  selectBudgetTemplate,
  validateBudgetSelection,
} from '../features/ai-reading/domain/budget';

const config = {
  version: 1 as const,
  presets: {
    quick: {
      maxModelTurns: 10,
      maxToolCalls: 15,
      maxReadCharacters: 30_000,
      maxDurationMs: 3 * 60_000,
      maxDelegatedAgents: 1,
      maxConcurrentAgents: 1,
    },
    standard: {
      maxModelTurns: 30,
      maxToolCalls: 45,
      maxReadCharacters: 100_000,
      maxDurationMs: 10 * 60_000,
      maxDelegatedAgents: 3,
      maxConcurrentAgents: 3,
    },
    deep: {
      maxModelTurns: 60,
      maxToolCalls: 90,
      maxReadCharacters: 250_000,
      maxDurationMs: 30 * 60_000,
      maxDelegatedAgents: 6,
      maxConcurrentAgents: 3,
    },
  },
  constraints: {
    maxModelTurns: { min: 3, max: 200, step: 1 },
    maxToolCalls: { min: 3, max: 300, step: 1 },
    maxReadCharacters: { min: 4_000, max: 2_000_000, step: 1_000 },
    maxDurationMs: { min: 60_000, max: 7_200_000, step: 60_000 },
    maxDelegatedAgents: { min: 0, max: 12, step: 1 },
    maxConcurrentAgents: { min: 0, max: 3, step: 1 },
  },
};

describe('AI 阅读预算表单状态', () => {
  it('默认从标准模板创建预设选择且请求不发送 policy', () => {
    const selection = createBudgetSelection(config);

    expect(selection).toEqual({
      budgetTier: 'standard',
      budgetMode: 'preset',
      budgetPolicy: config.presets.standard,
    });
    expect(selection.budgetPolicy).not.toBe(config.presets.standard);
    expect(budgetPolicyForRequest(selection)).toBeUndefined();
  });

  it('编辑任一字段转为自定义并发送完整克隆策略', () => {
    const standard = createBudgetSelection(config);
    const custom = customizeBudgetPolicy(standard, 'maxReadCharacters', 500_000);
    const payload = budgetPolicyForRequest(custom);

    expect(custom).toMatchObject({
      budgetTier: 'standard',
      budgetMode: 'custom',
      budgetPolicy: { maxReadCharacters: 500_000 },
    });
    expect(payload).toEqual(custom.budgetPolicy);
    expect(payload).not.toBe(custom.budgetPolicy);
    expect(standard.budgetMode).toBe('preset');
  });

  it('主动选择自定义保留当前值，只有重选模板才恢复预设', () => {
    const deep = selectBudgetTemplate(createBudgetSelection(config), config, 'deep');
    const custom = selectCustomBudget(deep);
    const editedBack = customizeBudgetPolicy(custom, 'maxModelTurns', 60);

    expect(custom.budgetPolicy).toEqual(config.presets.deep);
    expect(editedBack.budgetMode).toBe('custom');
    expect(selectBudgetTemplate(editedBack, config, 'quick')).toEqual({
      budgetTier: 'quick',
      budgetMode: 'preset',
      budgetPolicy: config.presets.quick,
    });
  });

  it('在界面以分钟编辑时限并精确转换为毫秒', () => {
    expect(budgetValueForInput('maxDurationMs', 30 * 60_000)).toBe(30);
    expect(policyValueFromInput('maxDurationMs', 45)).toBe(45 * 60_000);
    expect(policyValueFromInput('maxModelTurns', 45)).toBe(45);
  });

  it('校验范围、安全整数和子代理并发关系', () => {
    const selection = createBudgetSelection(config);
    expect(validateBudgetSelection(selection, config)).toEqual({});

    expect(validateBudgetSelection(
      customizeBudgetPolicy(selection, 'maxModelTurns', 2),
      config,
    ).maxModelTurns).toContain('3');
    expect(validateBudgetSelection(
      customizeBudgetPolicy(selection, 'maxToolCalls', 3.5),
      config,
    ).maxToolCalls).toContain('整数');
    expect(validateBudgetSelection({
      ...selection,
      budgetMode: 'custom',
      budgetPolicy: {
        ...selection.budgetPolicy,
        maxDelegatedAgents: 2,
        maxConcurrentAgents: 3,
      },
    }, config).maxConcurrentAgents).toContain('子代理总数');
    expect(validateBudgetSelection({
      ...selection,
      budgetMode: 'custom',
      budgetPolicy: {
        ...selection.budgetPolicy,
        maxDelegatedAgents: 0,
        maxConcurrentAgents: 1,
      },
    }, config).maxConcurrentAgents).toContain('必须为 0');
  });
});
