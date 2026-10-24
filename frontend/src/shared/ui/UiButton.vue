<template>
  <button
    :type="type"
    class="ui-button"
    :class="[`ui-button--${variant}`, `ui-button--${size}`, { 'ui-button--icon-only': iconOnly }]"
    :aria-label="iconOnly ? label : undefined"
    :title="iconOnly ? label : undefined"
  >
    <UiIcon v-if="icon" :name="icon" :size="size === 'sm' ? 14 : 16" />
    <slot v-if="!iconOnly" />
  </button>
</template>

<script setup lang="ts">
import UiIcon, { type IconName } from './UiIcon.vue';

withDefaults(defineProps<{
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
  icon?: IconName;
  /** 只显示图标时必须提供 label，作为无障碍名称和悬停提示 */
  iconOnly?: boolean;
  label?: string;
  type?: 'button' | 'submit' | 'reset';
}>(), { variant: 'secondary', size: 'md', type: 'button' });
</script>

<style scoped>
.ui-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 999px;
  border: 1px solid var(--ui-line);
  background: var(--ui-surface2);
  color: var(--ui-fg);
  font: inherit;
  font-weight: 700;
  line-height: 1.2;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s;
}
.ui-button--md { padding: 8px 16px; font-size: 13px; min-height: 36px; }
.ui-button--sm { padding: 5px 12px; font-size: 12px; min-height: 28px; }
.ui-button--icon-only.ui-button--md { padding: 0; width: 36px; }
.ui-button--icon-only.ui-button--sm { padding: 0; width: 28px; }
.ui-button--primary { background: var(--ui-strong); color: var(--ui-on-strong); border-color: transparent; }
.ui-button--ghost { background: transparent; }
.ui-button--danger { color: var(--ui-err); }
.ui-button:hover:not(:disabled) { border-color: color-mix(in srgb, var(--ui-fg) 30%, transparent); }
.ui-button--primary:hover:not(:disabled) { opacity: 0.88; }
.ui-button:focus-visible { outline: 2px solid var(--ui-fg); outline-offset: 2px; }
.ui-button:disabled { opacity: 0.45; cursor: not-allowed; }
</style>
