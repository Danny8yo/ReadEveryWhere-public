<template>
  <span class="book-analysis-help">
    <button
      type="button"
      class="book-analysis-help__trigger"
      aria-label="AI 预分析说明"
      :aria-expanded="visible"
      :aria-describedby="visible ? tooltipId : undefined"
      @mouseenter="hovered = true"
      @mouseleave="hovered = false"
      @focus="focused = true"
      @blur="focused = false"
      @click="togglePinned"
    >?</button>
    <span v-if="visible" :id="tooltipId" class="book-analysis-help__tooltip" :class="`book-analysis-help__tooltip--${placement}`" role="tooltip">
      {{ helpText }}
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed, ref, useId } from 'vue';

// placement：默认向上展开（批量操作条在屏幕底部）；画像抽屉顶部用 bottom，避免被抽屉边缘裁掉
withDefaults(defineProps<{ placement?: 'top' | 'bottom' }>(), { placement: 'top' });

const helpText = 'AI 预分析会读取书籍元数据、目录和少量正文，识别书籍的阅读结构，为后续 AI 阅读选择合适策略。不会修改原文或批注。';
const hovered = ref(false);
const focused = ref(false);
const pinned = ref(false);
const tooltipId = `book-analysis-help-${useId()}`;
const visible = computed(() => hovered.value || focused.value || pinned.value);

function togglePinned(event: MouseEvent) {
  pinned.value = !pinned.value;
  if (!pinned.value) {
    hovered.value = false;
    focused.value = false;
    (event.currentTarget as HTMLButtonElement | null)?.blur();
  }
}
</script>

<style scoped>
.book-analysis-help { position: relative; display: inline-flex; flex: 0 0 auto; }
.book-analysis-help__trigger { width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid currentColor; border-radius: 50%; color: var(--ui-muted); background: var(--ui-surface); font-size: 11px; font-weight: 800; line-height: 1; cursor: help; }
.book-analysis-help__trigger:hover, .book-analysis-help__trigger:focus-visible { color: var(--ui-fg); outline: none; }
.book-analysis-help__tooltip { position: absolute; z-index: var(--ui-z-dropdown); right: 0; width: min(19rem, calc(100vw - 2rem)); padding: 10px 12px; border: 1px solid var(--ui-line); border-radius: 12px; background: var(--ui-surface); box-shadow: 0 16px 34px -12px var(--ui-shadow); color: var(--ui-fg2); font-size: 12px; font-weight: 500; line-height: 1.6; text-align: left; white-space: normal; }
.book-analysis-help__tooltip--top { bottom: calc(100% + 8px); }
.book-analysis-help__tooltip--bottom { top: calc(100% + 8px); }
</style>
