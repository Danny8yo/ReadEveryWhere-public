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
    <span v-if="visible" :id="tooltipId" class="book-analysis-help__tooltip" role="tooltip">
      {{ helpText }}
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed, ref, useId } from 'vue';

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
.book-analysis-help__trigger { width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid currentColor; border-radius: 50%; color: #9ca3af; background: white; font-size: 11px; font-weight: 800; line-height: 1; }
.book-analysis-help__trigger:hover, .book-analysis-help__trigger:focus-visible { color: #111827; outline: none; }
.book-analysis-help__tooltip { position: absolute; z-index: 80; right: 0; bottom: calc(100% + 8px); width: min(19rem, calc(100vw - 2rem)); padding: 10px 12px; border: 1px solid #e5e7eb; border-radius: 6px; background: white; box-shadow: 0 10px 28px rgba(15, 23, 42, .12); color: #374151; font-size: 11px; font-weight: 500; line-height: 1.6; text-align: left; }
</style>
