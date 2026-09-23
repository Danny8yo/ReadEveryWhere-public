<template>
  <nav v-if="totalPages > 1" class="pagination" :aria-label="ariaLabel">
    <button
      class="pagination__btn pagination__btn--nav"
      :disabled="page <= 1 || isLoading"
      type="button"
      @click="emit('go', page - 1)"
    >
      上一页
    </button>

    <template v-for="entry in pages" :key="entry">
      <span v-if="entry === 'ellipsis'" class="pagination__ellipsis">...</span>
      <button
        v-else
        class="pagination__btn"
        :class="{ 'pagination__btn--active': entry === page }"
        type="button"
        :disabled="entry === page || isLoading"
        @click="emit('go', entry)"
      >
        {{ entry }}
      </button>
    </template>

    <button
      class="pagination__btn pagination__btn--nav"
      :disabled="page >= totalPages || isLoading"
      type="button"
      @click="emit('go', page + 1)"
    >
      下一页
    </button>
  </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue';

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
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  margin-top: 2.5rem;
}

.pagination__btn {
  min-width: 2.5rem;
  height: 2.5rem;
  border: 1px solid #111827;
  background: transparent;
  padding: 0 0.75rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: #111827;
  cursor: pointer;
  transition: background-color 0.25s ease, color 0.25s ease, transform 0.2s ease;
}

.pagination__btn:hover:not(:disabled) {
  background: #111827;
  color: #fff;
  transform: translateY(-1px);
}

.pagination__btn--active {
  background: #111827;
  color: #fff;
}

.pagination__btn--nav {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  padding: 0 1rem;
}

.pagination__btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.pagination__ellipsis {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2.5rem;
  height: 2.5rem;
  color: #9ca3af;
  font-size: 0.75rem;
  letter-spacing: 0.12em;
}
</style>
