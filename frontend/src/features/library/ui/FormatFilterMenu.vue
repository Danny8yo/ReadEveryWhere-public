<template>
  <div class="format-filter" role="group" aria-label="筛选书籍格式">
    <UiChip
      data-testid="clear-format-filter"
      :pressed="modelValue.length === 0"
      @click="emit('update:modelValue', [])"
    >
      全部格式
    </UiChip>
    <UiChip
      v-for="format in EBOOK_FORMATS"
      :key="format"
      :data-format="format"
      :pressed="modelValue.includes(format)"
      @click="toggle(format)"
    >
      {{ format.toUpperCase() }}
    </UiChip>
  </div>
</template>

<script setup lang="ts">
// 格式筛选：一排可多选的筛选标签。“全部格式”等于清空筛选。书架和采集共用。
import UiChip from '../../../shared/ui/UiChip.vue';
import { EBOOK_FORMATS, type EbookFormat } from '../../../shared/utils/bookFormat';

const props = defineProps<{ modelValue: EbookFormat[] }>();
const emit = defineEmits<{ 'update:modelValue': [formats: EbookFormat[]] }>();

const toggle = (format: EbookFormat) => {
  const next = props.modelValue.includes(format)
    ? props.modelValue.filter((entry) => entry !== format)
    : [...props.modelValue, format];
  emit('update:modelValue', EBOOK_FORMATS.filter((entry) => next.includes(entry)));
};
</script>

<style scoped>
.format-filter {
  display: flex;
  gap: 6px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.format-filter::-webkit-scrollbar { display: none; }
</style>
