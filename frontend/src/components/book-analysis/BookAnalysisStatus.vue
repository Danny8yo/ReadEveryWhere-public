<template>
  <span class="book-analysis-status" :class="`status-${status}`">
    {{ label }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { statusDisplayLabel } from '../../features/metadata/domain/analysisState';
import type { BookAnalysisStatus } from '../../features/metadata/model/bookAnalysis';

const props = defineProps<{ status: BookAnalysisStatus; label?: string | null }>();
const label = computed(() => props.label || statusDisplayLabel(props.status));
</script>

<style scoped>
.book-analysis-status { display: inline-flex; align-items: center; min-height: 20px; padding: 2px 6px; border: 1px solid #e5e7eb; border-radius: 4px; background: rgba(255,255,255,.92); color: #6b7280; font-size: 9px; font-weight: 750; white-space: nowrap; }
.status-ready { color: #15803d; border-color: #bbf7d0; }
.status-running, .status-pending { color: #1d4ed8; border-color: #bfdbfe; }
.status-failed, .status-stale, .status-unsupported { color: #b91c1c; border-color: #fecaca; }
</style>
