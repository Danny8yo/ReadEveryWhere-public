<template>
  <span class="book-analysis-status" :class="`status-${status}`">
    {{ label }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { statusDisplayLabel } from '../domain/analysisState';
import type { BookAnalysisStatus } from '../model/bookAnalysis';

const props = defineProps<{ status: BookAnalysisStatus; label?: string | null }>();
const label = computed(() => props.label || statusDisplayLabel(props.status));
</script>

<style scoped>
/* 与 UiStatus 同一视觉：小圆点 + 文字，颜色只表达状态 */
.book-analysis-status { --tone: var(--ui-muted); display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px; background: color-mix(in srgb, var(--tone) 16%, transparent); color: var(--tone); font-size: 11px; font-weight: 700; line-height: 1.5; white-space: nowrap; }
.book-analysis-status::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.status-ready { --tone: var(--ui-ok); }
.status-running, .status-pending { --tone: var(--ui-info); }
.status-stale { --tone: var(--ui-warn); }
.status-failed, .status-unsupported { --tone: var(--ui-err); }
</style>
