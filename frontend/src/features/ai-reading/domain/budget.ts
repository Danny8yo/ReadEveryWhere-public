import type { ReadingBudgetConfig, ReadingBudgetPolicy, ReadingBudgetPolicyField, ReadingBudgetSelection, ReadingBudgetTier } from '../model/aiReading';
export const READING_BUDGET_FIELDS: readonly ReadingBudgetPolicyField[] = [
    'maxModelTurns',
    'maxToolCalls',
    'maxReadCharacters',
    'maxDurationMs',
    'maxDelegatedAgents',
    'maxConcurrentAgents',
];
const FIELD_LABELS: Record<ReadingBudgetPolicyField, string> = {
    maxModelTurns: '模型轮次',
    maxToolCalls: '工具调用',
    maxReadCharacters: '阅读字符',
    maxDurationMs: '时限',
    maxDelegatedAgents: '子代理总数',
    maxConcurrentAgents: '最大并发数',
};
function clonePolicy(policy: ReadingBudgetPolicy): ReadingBudgetPolicy {
    return {
        maxModelTurns: policy.maxModelTurns,
        maxToolCalls: policy.maxToolCalls,
        maxReadCharacters: policy.maxReadCharacters,
        maxDurationMs: policy.maxDurationMs,
        maxDelegatedAgents: policy.maxDelegatedAgents,
        maxConcurrentAgents: policy.maxConcurrentAgents,
    };
}
export function createBudgetSelection(config: ReadingBudgetConfig, tier: ReadingBudgetTier = 'standard'): ReadingBudgetSelection {
    return {
        budgetTier: tier,
        budgetMode: 'preset',
        budgetPolicy: clonePolicy(config.presets[tier]),
    };
}
export function selectBudgetTemplate(_selection: ReadingBudgetSelection, config: ReadingBudgetConfig, tier: ReadingBudgetTier): ReadingBudgetSelection {
    return createBudgetSelection(config, tier);
}
export function selectCustomBudget(selection: ReadingBudgetSelection): ReadingBudgetSelection {
    return {
        ...selection,
        budgetMode: 'custom',
        budgetPolicy: clonePolicy(selection.budgetPolicy),
    };
}
export function customizeBudgetPolicy(selection: ReadingBudgetSelection, field: ReadingBudgetPolicyField, value: number): ReadingBudgetSelection {
    return {
        ...selection,
        budgetMode: 'custom',
        budgetPolicy: { ...selection.budgetPolicy, [field]: value },
    };
}
export function budgetValueForInput(field: ReadingBudgetPolicyField, value: number): number {
    return field === 'maxDurationMs' ? value / 60000 : value;
}
export function policyValueFromInput(field: ReadingBudgetPolicyField, value: number): number {
    return field === 'maxDurationMs' ? value * 60000 : value;
}
export function validateBudgetSelection(selection: ReadingBudgetSelection, config: ReadingBudgetConfig): Partial<Record<ReadingBudgetPolicyField, string>> {
    const errors: Partial<Record<ReadingBudgetPolicyField, string>> = {};
    for (const field of READING_BUDGET_FIELDS) {
        const value = selection.budgetPolicy[field];
        const constraint = config.constraints[field];
        const visibleValue = budgetValueForInput(field, value);
        const visibleMin = budgetValueForInput(field, constraint.min);
        const visibleMax = budgetValueForInput(field, constraint.max);
        if (!Number.isSafeInteger(value)) {
            errors[field] = `${FIELD_LABELS[field]}必须是整数`;
        }
        else if (value < constraint.min || value > constraint.max) {
            errors[field] = `${FIELD_LABELS[field]}需在 ${visibleMin} 到 ${visibleMax} 之间`;
        }
        else if (!Number.isFinite(visibleValue)) {
            errors[field] = `${FIELD_LABELS[field]}不是有效数字`;
        }
    }
    const { maxDelegatedAgents, maxConcurrentAgents } = selection.budgetPolicy;
    if (!errors.maxDelegatedAgents && !errors.maxConcurrentAgents) {
        if (maxDelegatedAgents === 0 && maxConcurrentAgents !== 0) {
            errors.maxConcurrentAgents = '子代理总数为 0 时，最大并发数必须为 0';
        }
        else if (maxDelegatedAgents > 0 && maxConcurrentAgents === 0) {
            errors.maxConcurrentAgents = '启用子代理时，最大并发数至少为 1';
        }
        else if (maxConcurrentAgents > maxDelegatedAgents) {
            errors.maxConcurrentAgents = '最大并发数不能超过子代理总数';
        }
    }
    return errors;
}
export function budgetPolicyForRequest(selection: ReadingBudgetSelection): ReadingBudgetPolicy | undefined {
    return selection.budgetMode === 'custom'
        ? clonePolicy(selection.budgetPolicy)
        : undefined;
}
