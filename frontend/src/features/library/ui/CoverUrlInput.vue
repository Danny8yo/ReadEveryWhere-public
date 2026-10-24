<template>
  <div class="cover-url">
    <UiField class="cover-url__field" label="封面链接" :for-id="inputId" :hint="hint" :error="coverLoadError && modelValue ? '图片加载失败，将显示生成封面' : null">
      <div class="cover-url__input">
        <input
          :id="inputId"
          type="url"
          class="ui-input"
          :value="modelValue ?? ''"
          placeholder="https://example.com/cover.jpg"
          @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        />
        <button v-if="modelValue" type="button" class="cover-url__clear" aria-label="清除封面链接" @click="$emit('update:modelValue', '')">
          <UiIcon name="close" :size="14" />
        </button>
      </div>
    </UiField>
    <div class="cover-url__preview" aria-hidden="true">
      <BookCover :title="title || '封面预览'" :cover-url="modelValue || null" />
    </div>
  </div>
</template>

<script setup lang="ts">
// 封面链接输入 + 实时预览。链接为空或图片加载失败时，预览显示按书名生成的封面（与书架一致）。
import { ref, useId, watch } from 'vue';
import BookCover from '../../../shared/ui/BookCover.vue';
import UiField from '../../../shared/ui/UiField.vue';
import UiIcon from '../../../shared/ui/UiIcon.vue';

const props = withDefaults(defineProps<{
  modelValue?: string | null;
  /** 用于生成封面预览的书名 */
  title?: string;
  hint?: string;
}>(), { title: '', hint: '留空则使用按书名生成的封面' });

defineEmits<{
  'update:modelValue': [value: string];
}>();

const inputId = `cover-url-${useId()}`;
const coverLoadError = ref(false);

// 预加载一次，失败时给出文字提示（预览本身由 BookCover 自动退回生成封面）
watch(() => props.modelValue, (url) => {
  coverLoadError.value = false;
  if (!url) return;
  const image = new Image();
  image.onerror = () => { if (props.modelValue === url) coverLoadError.value = true; };
  image.src = url;
}, { immediate: true });
</script>

<style scoped>
.cover-url { display: grid; grid-template-columns: minmax(0, 1fr) 56px; gap: 12px; align-items: end; }
.cover-url__field { min-width: 0; }
.cover-url__input { position: relative; }
.cover-url__input .ui-input { padding-right: 36px; }
.cover-url__clear {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--ui-muted);
  cursor: pointer;
}
.cover-url__clear:hover { color: var(--ui-fg); background: var(--ui-surface); }
.cover-url__preview { align-self: start; margin-top: 22px; }
.cover-url__preview :deep(.book-cover) { border-radius: 4px; box-shadow: 0 6px 14px -8px var(--ui-shadow); }
</style>
