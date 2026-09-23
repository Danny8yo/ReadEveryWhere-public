// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AiReadingBudgetEditor from '../components/ai-reading/AiReadingBudgetEditor.vue';
import { createBudgetSelection } from '../features/ai-reading/domain/budget';
import type { ReadingBudgetConfig, ReadingBudgetSelection } from '../features/ai-reading/model/aiReading';

const config: ReadingBudgetConfig = {
  version: 1,
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

function mountEditor(selection: ReadingBudgetSelection = createBudgetSelection(config)) {
  return mount(AiReadingBudgetEditor, {
    props: { config, modelValue: selection },
  });
}

describe('AiReadingBudgetEditor', () => {
  it('renders four compact modes and six unit-labelled numeric inputs', () => {
    const wrapper = mountEditor();

    expect(wrapper.findAll('.ai-budget-mode')).toHaveLength(4);
    expect(wrapper.text()).toContain('快速');
    expect(wrapper.text()).toContain('标准');
    expect(wrapper.text()).toContain('深入');
    expect(wrapper.text()).toContain('自定义');
    expect(wrapper.findAll('input[type="number"]')).toHaveLength(6);
    expect(wrapper.text()).toContain('分钟');
    expect(wrapper.text()).toContain('字符');
  });

  it('selects a preset with cloned values and explicit custom without changing values', async () => {
    const wrapper = mountEditor();
    await wrapper.get('[data-budget-mode="deep"]').trigger('click');
    const deep = wrapper.emitted('update:modelValue')?.at(-1)?.[0] as ReadingBudgetSelection;
    expect(deep).toMatchObject({
      budgetTier: 'deep',
      budgetMode: 'preset',
      budgetPolicy: { maxReadCharacters: 250_000 },
    });

    await wrapper.setProps({ modelValue: deep });
    await wrapper.get('[data-budget-mode="custom"]').trigger('click');
    const custom = wrapper.emitted('update:modelValue')?.at(-1)?.[0] as ReadingBudgetSelection;
    expect(custom).toMatchObject({
      budgetTier: 'deep',
      budgetMode: 'custom',
      budgetPolicy: deep.budgetPolicy,
    });
  });

  it('editing a field emits a custom selection and converts minutes to milliseconds', async () => {
    const wrapper = mountEditor();
    await wrapper.get('input[name="maxDurationMs"]').setValue('45');
    const changed = wrapper.emitted('update:modelValue')?.at(-1)?.[0] as ReadingBudgetSelection;

    expect(changed.budgetMode).toBe('custom');
    expect(changed.budgetTier).toBe('standard');
    expect(changed.budgetPolicy.maxDurationMs).toBe(45 * 60_000);
  });

  it('uses server constraints for input attributes and shows an inline concurrency error', async () => {
    const invalid: ReadingBudgetSelection = {
      ...createBudgetSelection(config),
      budgetMode: 'custom',
      budgetPolicy: {
        ...config.presets.standard,
        maxDelegatedAgents: 2,
        maxConcurrentAgents: 3,
      },
    };
    const wrapper = mountEditor(invalid);
    const duration = wrapper.get('input[name="maxDurationMs"]');

    expect(duration.attributes()).toMatchObject({ min: '1', max: '120', step: '1' });
    expect(wrapper.get('[data-budget-error="maxConcurrentAgents"]').text())
      .toContain('不能超过子代理总数');
    expect(wrapper.get('input[name="maxConcurrentAgents"]').attributes('aria-invalid')).toBe('true');
  });
});
