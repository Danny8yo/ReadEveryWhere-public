<template>
  <UiOverlay :open="isOpen && !!book" kind="modal" width="640px" labelledby="book-edit-title" @close="$emit('close')">
    <template v-if="book">
      <header class="ui-modal-head">
        <!-- 标题文字保留“维护书籍信息”（e2e 依赖） -->
        <div>
          <h2 id="book-edit-title">维护书籍信息</h2>
          <p>{{ book.title }}</p>
        </div>
        <UiButton variant="ghost" icon="close" icon-only label="关闭" @click="$emit('close')" />
      </header>

      <div class="ui-modal-body">
        <div class="ui-form-grid">
          <UiField label="书名" for-id="edit-title">
            <input id="edit-title" v-model="formData.title" type="text" class="ui-input" data-autofocus />
          </UiField>
          <UiField label="作者，逗号分隔" for-id="edit-authors">
            <input id="edit-authors" v-model="authorsString" type="text" class="ui-input" />
          </UiField>
          <UiField label="简介" for-id="edit-description" class="ui-form-grid__full">
            <textarea id="edit-description" v-model="formData.description" rows="4" class="ui-input" />
          </UiField>
          <CoverUrlInput v-model="formData.coverUrl" class="ui-form-grid__full" :title="formData.title || book.title" />
        </div>

        <!-- 只读字段（产品要求：ISBN、文件、来源不在这里修改） -->
        <dl class="ui-readonly">
          <div><dt>ISBN</dt><dd>{{ book.isbn || '未提供' }}</dd></div>
          <div><dt>文件</dt><dd>{{ book.fileName || '未提供' }}</dd></div>
          <div><dt>来源平台</dt><dd>{{ book.sourcePlatform }}</dd></div>
        </dl>
      </div>

      <footer class="ui-modal-foot">
        <UiButton @click="$emit('close')">取消</UiButton>
        <UiButton variant="primary" @click="save">保存更改</UiButton>
      </footer>
    </template>
  </UiOverlay>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import type { LibraryBook } from '../model/library';
import CoverUrlInput from './CoverUrlInput.vue';
import UiButton from '../../../shared/ui/UiButton.vue';
import UiField from '../../../shared/ui/UiField.vue';
import UiOverlay from '../../../shared/ui/UiOverlay.vue';

const props = defineProps<{
  isOpen: boolean;
  book: LibraryBook | null;
}>();

const emit = defineEmits<{
  close: [];
  save: [book: LibraryBook];
}>();

// 表单基于整本书展开：保存时完整带上后端允许编辑的字段（包括 language）
const formData = ref<Partial<LibraryBook>>({});

watch(() => props.book, (newBook) => {
  if (newBook) formData.value = { ...newBook };
}, { immediate: true });

// 辅助计算：把作者数组转为字符串，方便输入框编辑
const authorsString = computed({
  get: () => formData.value.authors?.join(', ') || '',
  set: (val) => formData.value.authors = val.split(',').map(s => s.trim()).filter(Boolean)
});

const save = () => {
  if (formData.value) {
    emit('save', formData.value as LibraryBook);
  }
  emit('close');
};
</script>
