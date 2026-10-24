<template>
  <UiOverlay :open="isOpen" kind="modal" width="640px" labelledby="manual-add-title" @close="$emit('close')">
    <header class="ui-modal-head">
      <div>
        <h2 id="manual-add-title">手动添加书籍</h2>
        <p>只登记书目信息，没有电子书文件；有文件请用“导入”。</p>
      </div>
      <UiButton variant="ghost" icon="close" icon-only label="关闭" @click="$emit('close')" />
    </header>

    <form class="ui-modal-body" novalidate @submit.prevent="submit">
      <div class="ui-form-grid">
        <UiField label="书名（必填）" for-id="manual-title" :error="errors.title">
          <input id="manual-title" v-model="formData.title" type="text" class="ui-input" placeholder="如：三体" data-autofocus :aria-invalid="!!errors.title" />
        </UiField>
        <UiField label="作者，逗号分隔（必填）" for-id="manual-authors" :error="errors.authors">
          <input id="manual-authors" v-model="authorsString" type="text" class="ui-input" placeholder="如：刘慈欣" :aria-invalid="!!errors.authors" />
        </UiField>
        <UiField label="ISBN（可选）" for-id="manual-isbn">
          <input id="manual-isbn" v-model="formData.isbn" type="text" class="ui-input" />
        </UiField>
        <UiField label="出版年份（可选）" for-id="manual-year">
          <input id="manual-year" v-model.number="formData.publishYear" type="number" class="ui-input" inputmode="numeric" />
        </UiField>
        <CoverUrlInput v-model="formData.coverUrl" class="ui-form-grid__full" :title="formData.title || ''" />
        <UiField label="简介（可选）" for-id="manual-description" class="ui-form-grid__full">
          <textarea id="manual-description" v-model="formData.description" rows="4" class="ui-input" />
        </UiField>
      </div>
      <button type="submit" hidden aria-hidden="true" tabindex="-1" />
    </form>

    <footer class="ui-modal-foot">
      <UiButton @click="$emit('close')">取消</UiButton>
      <UiButton variant="primary" icon="plus" @click="submit">确认添加</UiButton>
    </footer>
  </UiOverlay>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { AddBookManualParams } from '../model/library';
import CoverUrlInput from './CoverUrlInput.vue';
import UiButton from '../../../shared/ui/UiButton.vue';
import UiField from '../../../shared/ui/UiField.vue';
import UiOverlay from '../../../shared/ui/UiOverlay.vue';

const props = defineProps<{
  isOpen: boolean;
}>();

const emit = defineEmits<{
  close: [];
  save: [book: AddBookManualParams];
}>();

const emptyForm = (): Partial<AddBookManualParams> => ({
  title: '',
  coverUrl: '',
  description: '',
  isbn: '',
  publishYear: undefined,
  authors: [],
});
const formData = ref<Partial<AddBookManualParams>>(emptyForm());
// 必填项错误显示在字段下方（替代 alert）
const errors = ref<{ title: string | null; authors: string | null }>({ title: null, authors: null });

const authorsString = computed({
  get: () => formData.value.authors?.join(', ') || '',
  set: (val) => {
    formData.value.authors = val.split(',').map(s => s.trim()).filter(Boolean);
  }
});

watch(() => props.isOpen, (open) => { if (open) errors.value = { title: null, authors: null }; });

const submit = () => {
  errors.value = {
    title: formData.value.title?.trim() ? null : '请填写书名',
    authors: formData.value.authors?.length ? null : '请至少填写一位作者',
  };
  if (errors.value.title || errors.value.authors) return;

  emit('save', {
    title: formData.value.title as string,
    authors: formData.value.authors as string[],
    coverUrl: formData.value.coverUrl,
    description: formData.value.description,
    isbn: formData.value.isbn,
    publishYear: formData.value.publishYear,
    sourcePlatform: 'manual',
  });

  // 重置表单
  formData.value = emptyForm();
};
</script>
