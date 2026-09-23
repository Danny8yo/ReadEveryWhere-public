<template>
  <div ref="root" class="format-filter">
    <button
      type="button"
      class="format-filter__trigger"
      aria-label="筛选书籍格式"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span>格式</span>
      <strong>{{ summary }}</strong>
      <span aria-hidden="true">{{ open ? '▲' : '▼' }}</span>
    </button>

    <div v-if="open" class="format-filter__menu" role="group" aria-label="书籍格式">
      <label v-for="format in EBOOK_FORMATS" :key="format" class="format-filter__option">
        <input
          type="checkbox"
          :value="format"
          :checked="modelValue.includes(format)"
          @change="toggle(format)"
        />
        <span>{{ format.toUpperCase() }}</span>
      </label>
      <button
        data-testid="clear-format-filter"
        type="button"
        class="format-filter__clear"
        :disabled="modelValue.length === 0"
        @click="emit('update:modelValue', [])"
      >
        清除筛选
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { EBOOK_FORMATS, type EbookFormat } from '../utils/bookFormat';

const props = defineProps<{ modelValue: EbookFormat[] }>();
const emit = defineEmits<{ 'update:modelValue': [formats: EbookFormat[]] }>();
const open = ref(false);
const root = ref<HTMLElement | null>(null);

const summary = computed(() => props.modelValue.length === 0
  ? '全部'
  : props.modelValue.map((format) => format.toUpperCase()).join(' + '));

const toggle = (format: EbookFormat) => {
  const next = props.modelValue.includes(format)
    ? props.modelValue.filter((entry) => entry !== format)
    : [...props.modelValue, format];
  emit('update:modelValue', EBOOK_FORMATS.filter((entry) => next.includes(entry)));
};

const closeOutside = (event: MouseEvent) => {
  if (!root.value?.contains(event.target as Node)) open.value = false;
};

onMounted(() => document.addEventListener('click', closeOutside));
onBeforeUnmount(() => document.removeEventListener('click', closeOutside));
</script>

<style scoped>
.format-filter { position: relative; }
.format-filter__trigger {
  min-height: 2.5rem;
  min-width: 10rem;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
  border: 1px solid #d1d5db;
  background: #fff;
  padding: 0.6rem 0.75rem;
  color: #111827;
  font-size: 0.72rem;
}
.format-filter__trigger strong { font-weight: 700; }
.format-filter__menu {
  position: absolute;
  z-index: 80;
  top: calc(100% + 0.35rem);
  right: 0;
  width: 12rem;
  border: 1px solid #d1d5db;
  background: #fff;
  box-shadow: 0 12px 30px rgb(17 24 39 / 12%);
  padding: 0.45rem;
}
.format-filter__option {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  min-height: 2.35rem;
  padding: 0 0.45rem;
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
}
.format-filter__option:hover { background: #f3f4f6; }
.format-filter__option input { width: 1rem; height: 1rem; accent-color: #111827; }
.format-filter__clear {
  width: 100%;
  min-height: 2.25rem;
  border-top: 1px solid #e5e7eb;
  margin-top: 0.25rem;
  color: #4b5563;
  font-size: 0.72rem;
  text-align: left;
  padding: 0.45rem;
}
.format-filter__clear:disabled { color: #d1d5db; cursor: not-allowed; }
@media (max-width: 640px) {
  .format-filter__trigger { width: 100%; }
  .format-filter__menu { left: 0; right: auto; width: min(16rem, calc(100vw - 2rem)); }
}
</style>
