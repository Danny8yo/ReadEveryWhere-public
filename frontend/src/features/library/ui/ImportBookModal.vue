<template>
  <UiOverlay :open="isOpen" kind="modal" width="580px" labelledby="import-title" panel-class="import-modal" @close="close">
    <header class="import-modal__head">
      <h2 id="import-title">导入电子书</h2>
      <UiButton variant="ghost" icon="close" icon-only label="关闭" @click="close" />
    </header>

    <div class="import-modal__body">
      <!-- 拖放区：点击或拖入文件 -->
      <div
        data-testid="import-dropzone"
        class="import-drop"
        :class="{ 'import-drop--active': dragActive, 'import-drop--filled': selectedFiles.length > 0, 'import-drop--disabled': capabilitiesLoading || !importCapabilities }"
        role="button"
        tabindex="0"
        :aria-disabled="capabilitiesLoading || !importCapabilities"
        aria-label="选择电子书文件"
        @dragover.prevent="onDragOver"
        @dragenter.prevent="onDragEnter"
        @dragleave.prevent="onDragLeave"
        @drop.prevent="onDrop"
        @click="triggerFileInput"
        @keydown.enter.prevent="triggerFileInput"
        @keydown.space.prevent="triggerFileInput"
      >
        <input
          ref="fileInputRef"
          type="file"
          accept=".pdf,.epub,.mobi,.azw3"
          multiple
          :disabled="capabilitiesLoading || !importCapabilities"
          class="import-drop__input"
          tabindex="-1"
          @change="onFileSelected"
        />

        <template v-if="selectedFiles.length === 0">
          <span class="import-drop__icon" aria-hidden="true"><UiIcon name="upload" :size="26" /></span>
          <strong>拖拽电子书文件到此处</strong>
          <span class="import-drop__hint">或点击选择文件</span>
          <span v-if="capabilitiesLoading" class="import-drop__hint">正在读取上传限制...</span>
          <span v-else-if="capabilitiesError" class="import-drop__error">
            {{ capabilitiesError }}
            <button type="button" @click.stop="loadImportCapabilities">重试</button>
          </span>
          <span v-else class="import-drop__hint">支持 PDF、EPUB、MOBI、AZW3，最大 {{ maxFileSizeLabel }}</span>
        </template>

        <div v-else class="import-file">
          <UiIcon name="file" :size="20" />
          <div class="import-file__text">
            <strong v-if="selectedFiles.length === 1">{{ selectedFiles[0].name }}</strong>
            <strong v-else>已选择 {{ selectedFiles.length }} 个文件</strong>
            <span>{{ selectedFilesSizeLabel }}</span>
          </div>
          <UiButton size="sm" variant="ghost" icon="close" @click.stop="clearFiles">移除文件</UiButton>
        </div>
      </div>

      <!-- 单文件时可以顺手填书目信息 -->
      <div v-if="isSingleFileMode" class="import-modal__grid">
        <UiField label="书名（可选）" for-id="import-title-input">
          <input id="import-title-input" v-model="title" type="text" class="ui-input" :placeholder="inferredTitle || '自动从文件名推断'" />
        </UiField>
        <UiField label="作者，逗号分隔（可选）" for-id="import-authors">
          <input id="import-authors" v-model="authorsString" type="text" class="ui-input" placeholder="如：刘慈欣" />
        </UiField>
        <UiField label="ISBN（可选）" for-id="import-isbn">
          <input id="import-isbn" v-model="isbn" type="text" class="ui-input" />
        </UiField>
        <CoverUrlInput v-model="coverUrl" class="import-modal__full" :title="title || inferredTitle" />
      </div>

      <UiField label="同名文件处理">
        <UiSegmented v-model="conflictPolicy" :options="conflictOptions" label="同名文件处理" />
      </UiField>

      <p v-if="selectedFiles.length > 1" class="import-modal__note">
        批量导入只负责创建书籍与保存文件。导入完成后，可在书架中选中书籍并使用批量刮削。
      </p>

      <section v-if="importItems.length > 0" class="import-results">
        <div class="import-results__head">
          <h3>导入结果</h3>
          <span>{{ importedSummary }}</span>
        </div>
        <div v-for="item in importItems" :key="item.localId" class="import-results__item">
          <div class="import-results__text">
            <strong>{{ item.book?.title || item.originalFileName }}</strong>
            <span>{{ item.originalFileName }}</span>
            <span v-if="item.importStatus === 'failed'" class="import-results__error">{{ item.error }}</span>
            <span v-else>已导入，可关闭弹窗后在书架中批量刮削。</span>
          </div>
          <UiStatus :tone="statusTone(item.metadataStatus)">{{ metadataStatusLabel(item.metadataStatus) }}</UiStatus>
        </div>
      </section>
    </div>

    <footer class="import-modal__foot">
      <p v-if="errorMsg" class="import-modal__error" role="alert">{{ errorMsg }}</p>
      <UiButton @click="close">取消</UiButton>
      <UiButton
        data-testid="import-submit"
        variant="primary"
        icon="upload"
        :disabled="selectedFiles.length === 0 || submitting || capabilitiesLoading || !importCapabilities"
        @click="submit"
      >{{ submitting ? '导入中...' : selectedFiles.length > 1 ? '批量导入到书架' : '导入到书架' }}</UiButton>
    </footer>
  </UiOverlay>
</template>

<script setup lang="ts">
import type { BatchImportBookResultItem } from '../model/library';
import { ref, computed, watch } from 'vue';
import CoverUrlInput from './CoverUrlInput.vue';
import UiButton from '../../../shared/ui/UiButton.vue';
import UiField from '../../../shared/ui/UiField.vue';
import UiIcon from '../../../shared/ui/UiIcon.vue';
import UiOverlay from '../../../shared/ui/UiOverlay.vue';
import UiSegmented from '../../../shared/ui/UiSegmented.vue';
import UiStatus from '../../../shared/ui/UiStatus.vue';
import { useImportCapabilities } from '../web/useImportCapabilities';
import type { MetadataStatus } from '../model/library';
import { formatFileSize } from '../../../shared/utils/fileSize';

interface ImportModalItem extends BatchImportBookResultItem {
  localId: string;
}

const props = defineProps<{
  isOpen: boolean;
  importItems: ImportModalItem[];
}>();

const emit = defineEmits<{
  close: [];
  import: [params: { files: File[]; title?: string; authors?: string; isbn?: string; coverUrl?: string; conflictPolicy?: string }];
}>();

const fileInputRef = ref<HTMLInputElement | null>(null);
const selectedFiles = ref<File[]>([]);
const title = ref('');
const authorsString = ref('');
const isbn = ref('');
const coverUrl = ref('');
const conflictPolicy = ref<'rename' | 'skip' | 'overwrite'>('rename');
const submitting = ref(false);
const errorMsg = ref('');
const dragActive = ref(false);
const { importCapabilities, capabilitiesLoading, capabilitiesError, loadImportCapabilities } = useImportCapabilities(() => props.isOpen);

const conflictOptions = [
  { value: 'rename' as const, label: '自动重命名' },
  { value: 'skip' as const, label: '跳过' },
  { value: 'overwrite' as const, label: '覆盖' },
];

const inferredTitle = computed(() => {
  if (selectedFiles.value.length !== 1) return '';
  const name = selectedFiles.value[0].name.replace(/\.[^.]+$/, '');
  return name.replace(/[_-]/g, ' ').trim() || '';
});

const isSingleFileMode = computed(() => selectedFiles.value.length <= 1);

const selectedFilesSizeLabel = computed(() => {
  const totalSize = selectedFiles.value.reduce((sum, file) => sum + file.size, 0);
  return selectedFiles.value.length === 1
    ? formatFileSize(selectedFiles.value[0].size)
    : `${selectedFiles.value.length} 个文件 · ${formatFileSize(totalSize)}`;
});

const maxFileSizeLabel = computed(() => {
  if (!importCapabilities.value) return '';
  return formatFileSize(importCapabilities.value.maxFileSizeBytes);
});

const importedSummary = computed(() => {
  const imported = props.importItems.filter((item) => item.importStatus === 'imported').length;
  const failed = props.importItems.filter((item) => item.importStatus === 'failed').length;
  return `${imported} 本已导入 · ${failed} 本失败`;
});

const triggerFileInput = () => {
  if (!importCapabilities.value || capabilitiesLoading.value) return;
  fileInputRef.value?.click();
};

const onDragOver = () => {};
const onDragEnter = () => { dragActive.value = true; };
const onDragLeave = () => { dragActive.value = false; };

const onDrop = (e: DragEvent) => {
  dragActive.value = false;
  if (!importCapabilities.value || capabilitiesLoading.value) return;
  setSelectedFiles(Array.from(e.dataTransfer?.files ?? []));
};

const onFileSelected = (e: Event) => {
  if (!importCapabilities.value || capabilitiesLoading.value) return;
  const input = e.target as HTMLInputElement;
  setSelectedFiles(Array.from(input.files ?? []));
};

// 后端批量导入单次上限 20（与 library.controller 的 FilesInterceptor 保持一致）
const MAX_BATCH_FILES = 20;

const setSelectedFiles = (files: File[]) => {
  if (!importCapabilities.value) {
    throw new Error('Import capabilities must be loaded before selecting files');
  }
  const validFiles = files.filter(isValidFile);
  if (files.length > 0 && validFiles.length === 0) return;
  if (validFiles.length > MAX_BATCH_FILES) {
    errorMsg.value = `单次最多导入 ${MAX_BATCH_FILES} 个文件，已自动保留前 ${MAX_BATCH_FILES} 个`;
    selectedFiles.value = validFiles.slice(0, MAX_BATCH_FILES);
    return;
  }
  selectedFiles.value = validFiles;
};

const isValidFile = (file: File): boolean => {
  if (!importCapabilities.value) {
    throw new Error('Import capabilities must be loaded before validating files');
  }
  const ext = file.name.split('.').pop()?.toLowerCase();
  const allowed = ['pdf', 'epub', 'mobi', 'azw3'];
  if (!ext || !allowed.includes(ext)) {
    errorMsg.value = '不支持的文件格式，仅支持 PDF、EPUB、MOBI、AZW3';
    return false;
  }
  if (file.size > importCapabilities.value.maxFileSizeBytes) {
    errorMsg.value = `文件大小不能超过 ${maxFileSizeLabel.value}`;
    return false;
  }
  errorMsg.value = '';
  return true;
};

const clearFiles = () => {
  selectedFiles.value = [];
  if (fileInputRef.value) {
    fileInputRef.value.value = '';
  }
};

const resetForm = () => {
  selectedFiles.value = [];
  title.value = '';
  authorsString.value = '';
  isbn.value = '';
  coverUrl.value = '';
  conflictPolicy.value = 'rename';
  errorMsg.value = '';
  submitting.value = false;
  if (fileInputRef.value) {
    fileInputRef.value.value = '';
  }
};

const setSubmitting = (value: boolean) => {
  submitting.value = value;
};

const submit = () => {
  if (selectedFiles.value.length === 0) return;
  submitting.value = true;
  errorMsg.value = '';

  // 始终发送书名：用户填写 > 从文件名推断（前端侧 file.name 保证 UTF-8 正确，
  // 绕过后端 multer 解析 Content-Disposition 时的 CJK 编码问题）
  const finalTitle = title.value || inferredTitle.value;

  emit('import', {
    files: selectedFiles.value,
    title: selectedFiles.value.length === 1 ? finalTitle || undefined : undefined,
    authors: selectedFiles.value.length === 1 ? authorsString.value || undefined : undefined,
    isbn: selectedFiles.value.length === 1 ? isbn.value || undefined : undefined,
    coverUrl: selectedFiles.value.length === 1 ? coverUrl.value || undefined : undefined,
    conflictPolicy: conflictPolicy.value,
  });
};

const metadataStatusLabel = (status: MetadataStatus): string => {
  const labels: Record<MetadataStatus, string> = {
    none: '无刮削',
    pending: '待刮削',
    scraping: '刮削中',
    candidates_found: '找到候选',
    applied: '已应用',
    skipped: '已跳过',
    failed: '失败',
  };
  return labels[status] ?? status;
};

const statusTone = (status: MetadataStatus): 'ok' | 'err' | 'info' | 'muted' => {
  if (status === 'applied') return 'ok';
  if (status === 'failed') return 'err';
  if (status === 'scraping' || status === 'candidates_found') return 'info';
  return 'muted';
};

const close = () => {
  resetForm();
  emit('close');
};

watch(() => props.isOpen, (val) => {
  if (!val) resetForm();
}, { immediate: true });

defineExpose({ resetForm, setSubmitting });
</script>

<style scoped>
.import-modal__head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 20px 22px 6px; }
.import-modal__head h2 { margin: 0; font-size: 18px; font-weight: 900; }
.import-modal__body { display: grid; gap: 16px; padding: 10px 22px 18px; }
.import-drop {
  display: grid;
  justify-items: center;
  gap: 6px;
  padding: 24px 18px;
  border: 1.5px dashed color-mix(in srgb, var(--ui-fg) 28%, transparent);
  border-radius: var(--ui-radius-card);
  background: var(--ui-surface);
  text-align: center;
  cursor: pointer;
  transition: border-color 0.15s, background-color 0.15s;
}
.import-drop:hover, .import-drop--active { border-color: var(--ui-fg); }
.import-drop--active { background: color-mix(in srgb, var(--ui-fg) 5%, var(--ui-surface)); }
.import-drop--filled { padding: 14px 16px; border-style: solid; cursor: default; }
.import-drop--disabled { cursor: not-allowed; opacity: 0.7; }
.import-drop:focus-visible { outline: 2px solid var(--ui-fg); outline-offset: 2px; }
.import-drop__input { display: none; }
.import-drop__icon { display: grid; place-items: center; width: 52px; height: 52px; border-radius: 50%; background: var(--ui-surface2); color: var(--ui-muted); }
.import-drop strong { font-size: 15px; }
.import-drop__hint { font-size: 12px; color: var(--ui-muted); }
.import-drop__error { font-size: 12px; color: var(--ui-err); }
.import-drop__error button { margin-left: 6px; border: 0; background: none; color: inherit; font: inherit; text-decoration: underline; cursor: pointer; }
.import-file { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px; width: 100%; text-align: left; }
.import-file__text { display: grid; min-width: 0; }
.import-file__text strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.import-file__text span { font-size: 12px; color: var(--ui-muted); }
.import-modal__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.import-modal__full { grid-column: 1 / -1; }
.import-modal__note { margin: 0; font-size: 12px; color: var(--ui-muted); line-height: 1.6; }
.import-results { display: grid; gap: 8px; padding-top: 14px; border-top: 1px solid var(--ui-line); }
.import-results__head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
.import-results__head h3 { margin: 0; font-size: 14px; font-weight: 900; }
.import-results__head span { font-size: 12px; color: var(--ui-muted); }
.import-results__item { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 10px; padding: 10px 12px; border: 1px solid var(--ui-line); border-radius: 12px; background: var(--ui-surface); }
.import-results__text { display: grid; gap: 2px; min-width: 0; }
.import-results__text strong { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.import-results__text span { font-size: 12px; color: var(--ui-muted); overflow-wrap: anywhere; }
.import-results__error { color: var(--ui-err) !important; }
.import-modal__foot {
  position: sticky;
  bottom: 0;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  padding: 14px 22px calc(14px + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid var(--ui-line);
  background: var(--ui-bg);
}
.import-modal__error { flex-basis: 100%; margin: 0; color: var(--ui-err); font-size: 13px; }
@media (max-width: 640px) {
  .import-modal__grid { grid-template-columns: 1fr; }
}
</style>
