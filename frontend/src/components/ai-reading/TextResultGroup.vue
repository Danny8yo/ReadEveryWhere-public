<template>
  <section v-if="items.length" class="text-result-group">
    <h4>{{ title }}</h4>
    <ul>
      <li v-for="(item, index) in items" :key="typeof item === 'string' ? `${index}-${item}` : item.id">
        {{ typeof item === 'string' ? item : item.statement }}
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import type { ReadingResultItem } from '../../features/ai-reading/model/aiReading';
defineProps<{ title: string; items: Array<string | ReadingResultItem> }>();
</script>

<style scoped>
.text-result-group { margin-top: 18px; }.text-result-group h4 { margin: 0 0 8px; color: var(--rd-muted); font-size: 10px; font-weight: 800; letter-spacing: .08em; }.text-result-group ul { margin: 0; padding-left: 18px; color: var(--rd-fg); font-size: 12px; line-height: 1.65; }.text-result-group li + li { margin-top: 7px; }
</style>
