<template>
  <form class="search-input" role="search" @submit.prevent="handleSearch">
    <UiIcon name="search" :size="18" />
    <input
      :value="modelValue"
      type="text"
      class="search-input__field"
      placeholder="输入书名、作者或关键词..."
      aria-label="搜索书名、作者或关键词"
      enterkeyhint="search"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <UiButton class="search-input__button" variant="primary" type="submit">搜索</UiButton>
  </form>
</template>

<script setup lang="ts">
import UiButton from '../../../shared/ui/UiButton.vue';
import UiIcon from '../../../shared/ui/UiIcon.vue';

const props = withDefaults(defineProps<{
  modelValue?: string;
}>(), {
  modelValue: '',
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
  search: [value: string];
}>();

const handleSearch = () => {
  emit('search', props.modelValue);
};
</script>

<style scoped>
.search-input {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  max-width: 600px;
  margin: 0 auto;
  padding: 6px 6px 6px 18px;
  border: 1px solid var(--ui-line);
  border-radius: 999px;
  background: var(--ui-surface);
  color: var(--ui-muted);
  box-shadow: 0 10px 30px -18px var(--ui-shadow);
}
.search-input:focus-within { border-color: var(--ui-fg); color: var(--ui-fg); }
.search-input__field {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--ui-fg);
  font: inherit;
  font-size: 17px;
}
.search-input__field::placeholder { color: var(--ui-muted); }
.search-input__button { flex: none; }
</style>
