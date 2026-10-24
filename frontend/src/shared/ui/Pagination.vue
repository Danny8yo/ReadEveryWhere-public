<template>
  <!-- 用 role 而不是 <nav>：应用外壳约定页面上只有一个 <nav>（e2e 依赖） -->
  <div v-if="totalPages > 1" class="pagination" role="navigation" :aria-label="ariaLabel">
    <button
      class="pagination__btn"
      type="button"
      aria-label="上一页"
      :disabled="page <= 1 || isLoading"
      @click="emit('go', page - 1)"
    >
      <UiIcon name="back" :size="14" />
    </button>

    <template v-for="(entry, index) in pages" :key="`${entry}-${index}`">
      <span v-if="entry === 'ellipsis'" class="pagination__ellipsis" aria-hidden="true">…</span>
      <button
        v-else
        class="pagination__btn"
        :class="{ 'pagination__btn--active': entry === page }"
        type="button"
        :aria-current="entry === page ? 'page' : undefined"
        :disabled="entry === page || isLoading"
        @click="emit('go', entry)"
      >
        {{ entry }}
      </button>
    </template>

    <button
      class="pagination__btn"
      type="button"
      aria-label="下一页"
      :disabled="page >= totalPages || isLoading"
      @click="emit('go', page + 1)"
    >
      <UiIcon name="forward" :size="14" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import UiIcon from './UiIcon.vue';

const props = withDefaults(defineProps<{
  page: number;
  totalPages: number;
  isLoading?: boolean;
  ariaLabel?: string;
}>(), {
  isLoading: false,
  ariaLabel: '分页',
});

const emit = defineEmits<{
  go: [page: number];
}>();

const pages = computed(() => {
  const current = props.page;
  const total = props.totalPages;

  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const items: (number | 'ellipsis')[] = [1];

  const start = Math.max(2, current - 2);
  const end = Math.min(total - 1, current + 2);

  if (start > 2) {
    items.push('ellipsis');
  }

  for (let i = start; i <= end; i++) {
    items.push(i);
  }

  if (end < total - 1) {
    items.push('ellipsis');
  }

  items.push(total);
  return items;
});
</script>

<style scoped>
.pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 32px;
}
.pagination__btn {
  min-width: 34px;
  height: 34px;
  display: inline-grid;
  place-items: center;
  padding: 0 10px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ui-muted);
  font: inherit;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.pagination__btn:hover:not(:disabled) { background: var(--ui-surface2); color: var(--ui-fg); }
.pagination__btn:disabled { opacity: 0.35; cursor: not-allowed; }
/* 当前页也是 disabled（不能再点），但要实心显示：放在通用 disabled 规则之后并提高特异性 */
.pagination__btn.pagination__btn--active { background: var(--ui-strong); color: var(--ui-on-strong); font-weight: 700; cursor: default; opacity: 1; }
.pagination__btn:focus-visible { outline: 2px solid var(--ui-fg); outline-offset: 2px; }
.pagination__ellipsis { min-width: 24px; text-align: center; color: var(--ui-muted); }
</style>
