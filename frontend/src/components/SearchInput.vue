<template>
  <div class="search-input">
    <input
      :value="modelValue"
      type="text"
      class="search-input__field"
      placeholder="输入书名、作者或关键词..."
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      @keyup.enter="handleSearch"
    />
    <button class="search-input__button" type="button" @click="handleSearch">
      Search
    </button>
  </div>
</template>

<script setup lang="ts">
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
  position: relative;
  width: 100%;
  max-width: 48rem;
  margin: 0 auto;
}

.search-input__field {
  width: 100%;
  border: 0;
  border-bottom: 2px solid rgba(17, 24, 39, 0.12);
  background: transparent;
  padding: 1.25rem 6rem 1.25rem 0;
  font-size: clamp(1.5rem, 2vw, 2.25rem);
  font-family: Georgia, 'Times New Roman', serif;
  color: #0f172a;
  outline: none;
  transition: border-color 0.35s ease;
}

.search-input__field::placeholder {
  color: rgba(148, 163, 184, 0.9);
}

.search-input__field:focus {
  border-bottom-color: #111827;
}

.search-input__button {
  position: absolute;
  right: 0;
  bottom: 1.1rem;
  border: 0;
  background: transparent;
  padding: 0;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: #111827;
  cursor: pointer;
  transition: opacity 0.2s ease;
}

.search-input__button:hover {
  opacity: 0.55;
}
</style>
