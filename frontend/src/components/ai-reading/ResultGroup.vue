<template>
  <section v-if="items.length" class="result-group">
    <h4>{{ title }}</h4>
    <article v-for="item in items" :key="item.id" class="result-item">
      <p>{{ item.statement }}</p>
      <div v-if="item.evidenceIds.length" class="evidence-list">
        <button
          v-for="evidenceId in item.evidenceIds"
          :key="evidenceId"
          type="button"
          :disabled="!evidenceById.has(evidenceId)"
          @click="emitEvidence(evidenceId)"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12h6M12 9v6"/><circle cx="12" cy="12" r="9"/></svg>
          {{ evidenceLabel(evidenceId) }}
        </button>
      </div>
    </article>
  </section>
</template>

<script setup lang="ts">
import type { ReadingEvidence, ReadingResultItem } from '../../features/ai-reading/model/aiReading';

const props = defineProps<{
  title: string;
  items: ReadingResultItem[];
  evidenceById: Map<string, ReadingEvidence>;
}>();
const emit = defineEmits<{ citation: [evidence: ReadingEvidence] }>();

function emitEvidence(id: string) {
  const evidence = props.evidenceById.get(id);
  if (evidence) emit('citation', evidence);
}

function evidenceLabel(id: string) {
  const evidence = props.evidenceById.get(id);
  if (!evidence) return id;
  const source = evidence.citation.chapterPath || evidence.citation.bookTitle;
  const quote = evidence.quote.trim().replace(/\s+/g, ' ');
  return quote ? `${source} · “${quote.slice(0, 48)}${quote.length > 48 ? '…' : ''}”` : source;
}
</script>

<style scoped>
.result-group { margin-top: 18px; }.result-group:first-of-type { margin-top: 0; }.result-group h4 { margin: 0 0 8px; color: var(--rd-muted); font-size: 10px; font-weight: 800; letter-spacing: .08em; }.result-item { padding: 10px 0; border-top: 1px solid var(--rd-divider); }.result-item p { margin: 0; color: var(--rd-fg); font-size: 12px; line-height: 1.65; overflow-wrap: anywhere; }.evidence-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }.evidence-list button { max-width: 100%; display: inline-flex; align-items: center; gap: 4px; padding: 5px 7px; border: 1px solid var(--rd-border); border-radius: 5px; color: var(--rd-muted-strong); background: var(--rd-chip-bg); font-size: 9px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.evidence-list button:hover:not(:disabled) { color: var(--rd-fg); border-color: var(--rd-accent); }.evidence-list button:disabled { opacity: .45; cursor: not-allowed; }
</style>
