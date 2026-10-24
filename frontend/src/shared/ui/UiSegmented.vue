<template>
  <div class="ui-segmented" role="radiogroup" :aria-label="label" @keydown="onKeydown">
    <button
      v-for="option in options"
      :key="option.value"
      ref="buttons"
      type="button"
      role="radio"
      class="ui-segmented__item"
      :class="{ 'ui-segmented__item--on': option.value === modelValue }"
      :aria-checked="option.value === modelValue"
      :aria-label="option.icon && !option.text ? option.label : undefined"
      :title="option.icon && !option.text ? option.label : undefined"
      :tabindex="option.value === modelValue ? 0 : -1"
      :disabled="disabled"
      @click="emit('update:modelValue', option.value)"
    >
      <UiIcon v-if="option.icon" :name="option.icon" :size="14" />
      <span v-if="option.text !== false">{{ option.label }}</span>
    </button>
  </div>
</template>

<script setup lang="ts" generic="T extends string">
import { ref } from 'vue';
import UiIcon, { type IconName } from './UiIcon.vue';

const props = defineProps<{
  modelValue: T;
  options: Array<{ value: T; label: string; icon?: IconName; /** false 时只显示图标 */ text?: boolean }>;
  label: string;
  disabled?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: T] }>();
const buttons = ref<HTMLButtonElement[]>([]);

// 方向键在选项间移动，符合 radiogroup 的键盘习惯
function onKeydown(event: KeyboardEvent) {
  const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
  if (!step || props.disabled) return;
  event.preventDefault();
  const index = props.options.findIndex(option => option.value === props.modelValue);
  const next = (index + step + props.options.length) % props.options.length;
  emit('update:modelValue', props.options[next].value);
  buttons.value[next]?.focus();
}
</script>

<style scoped>
.ui-segmented {
  display: inline-flex;
  justify-self: start;
  max-width: 100%;
  overflow-x: auto;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--ui-line);
  border-radius: 999px;
  background: var(--ui-surface2);
}
.ui-segmented__item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 0;
  border-radius: 999px;
  padding: 4px 12px;
  background: transparent;
  color: var(--ui-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.ui-segmented__item--on {
  background: var(--ui-surface);
  color: var(--ui-fg);
  font-weight: 700;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
}
:root[data-theme="dark"] .ui-segmented__item--on { background: var(--ui-strong); color: var(--ui-on-strong); }
.ui-segmented__item:focus-visible { outline: 2px solid var(--ui-fg); outline-offset: 1px; }
.ui-segmented__item:disabled { cursor: not-allowed; opacity: 0.5; }
</style>
