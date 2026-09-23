<template>
  <div class="ai-budget-editor">
    <div class="ai-budget-modes" role="group" aria-label="预算模式">
      <button
        v-for="option in modeOptions"
        :key="option.value"
        class="ai-budget-mode"
        :class="{ active: isModeActive(option.value) }"
        :data-budget-mode="option.value"
        type="button"
        :aria-pressed="isModeActive(option.value)"
        :disabled="disabled"
        @click="chooseMode(option.value)"
      >
        {{ option.label }}
      </button>
    </div>

    <div class="ai-budget-fields">
      <label v-for="field in fieldOptions" :key="field.key" class="ai-budget-field">
        <span class="ai-budget-field-label">{{ field.label }}</span>
        <span class="ai-budget-input-wrap">
          <input
            :id="`ai-budget-${field.key}`"
            :name="field.key"
            type="number"
            inputmode="numeric"
            :value="inputValue(field.key)"
            :min="inputConstraint(field.key, 'min')"
            :max="inputConstraint(field.key, 'max')"
            :step="inputConstraint(field.key, 'step')"
            :disabled="disabled"
            :aria-invalid="Boolean(errors[field.key])"
            :aria-describedby="errors[field.key] ? `ai-budget-error-${field.key}` : undefined"
            @input="updateField(field.key, $event)"
          >
          <span class="ai-budget-unit">{{ field.unit }}</span>
        </span>
        <span
          v-if="errors[field.key]"
          :id="`ai-budget-error-${field.key}`"
          class="ai-budget-field-error"
          :data-budget-error="field.key"
          role="alert"
        >
          {{ errors[field.key] }}
        </span>
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  budgetValueForInput,
  customizeBudgetPolicy,
  policyValueFromInput,
  selectBudgetTemplate,
  selectCustomBudget,
  validateBudgetSelection,
} from '../../features/ai-reading/domain/budget';
import type {
  ReadingBudgetConfig,
  ReadingBudgetPolicyField,
  ReadingBudgetSelection,
  ReadingBudgetTier,
} from '../../features/ai-reading/model/aiReading';

const props = withDefaults(defineProps<{
  config: ReadingBudgetConfig;
  modelValue: ReadingBudgetSelection;
  disabled?: boolean;
}>(), {
  disabled: false,
});

const emit = defineEmits<{
  'update:modelValue': [selection: ReadingBudgetSelection];
}>();

type BudgetModeOption = ReadingBudgetTier | 'custom';

const modeOptions: Array<{ value: BudgetModeOption; label: string }> = [
  { value: 'quick', label: '快速' },
  { value: 'standard', label: '标准' },
  { value: 'deep', label: '深入' },
  { value: 'custom', label: '自定义' },
];

const fieldOptions: Array<{
  key: ReadingBudgetPolicyField;
  label: string;
  unit: string;
}> = [
  { key: 'maxModelTurns', label: '模型轮次', unit: '轮' },
  { key: 'maxToolCalls', label: '工具调用', unit: '次' },
  { key: 'maxReadCharacters', label: '阅读字符', unit: '字符' },
  { key: 'maxDurationMs', label: '时限', unit: '分钟' },
  { key: 'maxDelegatedAgents', label: '子代理总数', unit: '个' },
  { key: 'maxConcurrentAgents', label: '最大并发数', unit: '个' },
];

const errors = computed(() => validateBudgetSelection(props.modelValue, props.config));

function isModeActive(mode: BudgetModeOption): boolean {
  return mode === 'custom'
    ? props.modelValue.budgetMode === 'custom'
    : props.modelValue.budgetMode === 'preset' && props.modelValue.budgetTier === mode;
}

function chooseMode(mode: BudgetModeOption): void {
  emit('update:modelValue', mode === 'custom'
    ? selectCustomBudget(props.modelValue)
    : selectBudgetTemplate(props.modelValue, props.config, mode));
}

function inputValue(field: ReadingBudgetPolicyField): number {
  return budgetValueForInput(field, props.modelValue.budgetPolicy[field]);
}

function inputConstraint(
  field: ReadingBudgetPolicyField,
  key: 'min' | 'max' | 'step',
): number {
  return budgetValueForInput(field, props.config.constraints[field][key]);
}

function updateField(field: ReadingBudgetPolicyField, event: Event): void {
  const input = event.target as HTMLInputElement;
  const visibleValue = input.value === '' ? Number.NaN : Number(input.value);
  emit('update:modelValue', customizeBudgetPolicy(
    props.modelValue,
    field,
    policyValueFromInput(field, visibleValue),
  ));
}
</script>

<style scoped>
.ai-budget-editor { margin-top: 10px; }
.ai-budget-modes { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 3px; padding: 3px; border-radius: 6px; background: var(--rd-chip-bg); }
.ai-budget-mode { min-width: 0; min-height: 30px; padding: 6px 3px; border-radius: 4px; color: var(--rd-muted); font-size: 11px; font-weight: 650; }
.ai-budget-mode.active { color: var(--rd-accent-fg); background: var(--rd-accent); }
.ai-budget-mode:disabled { opacity: .45; cursor: not-allowed; }
.ai-budget-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px; margin-top: 12px; }
.ai-budget-field { min-width: 0; }
.ai-budget-field-label { display: block; margin-bottom: 5px; color: var(--rd-muted-strong); font-size: 10px; font-weight: 650; }
.ai-budget-input-wrap { min-height: 32px; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; border: 1px solid var(--rd-border); border-radius: 5px; background: var(--rd-chip-bg); }
.ai-budget-input-wrap:focus-within { border-color: var(--rd-accent); }
.ai-budget-input-wrap input { width: 100%; min-width: 0; height: 30px; padding: 5px 4px 5px 8px; border: 0; outline: 0; color: var(--rd-fg); background: transparent; font-size: 11px; font-variant-numeric: tabular-nums; }
.ai-budget-input-wrap input[aria-invalid="true"] { color: #dc2626; }
.ai-budget-unit { padding: 0 8px 0 4px; color: var(--rd-muted); font-size: 9px; white-space: nowrap; }
.ai-budget-field-error { display: block; margin-top: 4px; color: #dc2626; font-size: 9px; line-height: 1.4; overflow-wrap: anywhere; }
@media (max-width: 360px) { .ai-budget-fields { grid-template-columns: 1fr; } }
</style>
