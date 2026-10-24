<template>
  <button type="button" class="ui-chip" :class="{ 'ui-chip--on': pressed }" :aria-pressed="pressed">
    <slot />
  </button>
</template>

<script setup lang="ts">
// 可切换的筛选标签（胶囊）。点击逻辑由父组件处理。
defineProps<{ pressed: boolean }>();
</script>

<style scoped>
.ui-chip {
  flex: none;
  border: 1px solid var(--ui-line);
  background: var(--ui-surface);
  color: var(--ui-muted);
  border-radius: 999px;
  padding: 4px 12px;
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
}
.ui-chip--on { background: var(--ui-strong); color: var(--ui-on-strong); border-color: transparent; font-weight: 700; }
.ui-chip:focus-visible { outline: 2px solid var(--ui-fg); outline-offset: 2px; }
.ui-chip:disabled { opacity: 0.45; cursor: not-allowed; }
</style>
