<template>
  <Transition name="slide">
    <div v-if="isOpen" class="fixed inset-y-0 right-0 w-full max-w-xl bg-white shadow-2xl z-50 p-4 md:p-12 flex flex-col justify-between overflow-y-auto">

      <!-- 头部 -->
      <div class="flex justify-between items-center mb-8">
        <h2 class="text-xl font-serif">导入电子书</h2>
        <button @click="close" class="text-xs font-bold uppercase tracking-widest hover:text-gray-500 transition-colors">
          关闭 [x]
        </button>
      </div>

      <!-- 内容区 -->
      <div class="flex-1 overflow-y-auto pr-4 space-y-6 custom-scrollbar">
        <!-- 拖拽上传区域 -->
        <div
          class="relative border-2 border-dashed rounded-sm p-4 md:p-12 text-center transition-all duration-200"
          :class="dragZoneClass"
          @dragover.prevent="onDragOver"
          @dragenter.prevent="onDragEnter"
          @dragleave.prevent="onDragLeave"
          @drop.prevent="onDrop"
          @click="triggerFileInput"
        >
          <input
            ref="fileInputRef"
            type="file"
            accept=".pdf,.epub,.mobi,.azw3"
            multiple
            :disabled="capabilitiesLoading || !importCapabilities"
            class="hidden"
            @change="onFileSelected"
          />

          <template v-if="selectedFiles.length === 0">
            <div class="text-5xl text-gray-300 mb-4">&#8627;</div>
            <p class="text-sm font-serif text-gray-500 mb-2">拖拽电子书文件到此处</p>
            <p class="text-[10px] font-bold uppercase tracking-widest text-gray-400">
              或点击选择文件
            </p>
            <p v-if="capabilitiesLoading" class="text-[9px] text-gray-400 mt-3">
              正在读取上传限制...
            </p>
            <p v-else-if="capabilitiesError" class="text-[9px] text-red-500 mt-3">
              {{ capabilitiesError }}
              <button type="button" class="ml-2 underline" @click.stop="loadImportCapabilities">重试</button>
            </p>
            <p v-else class="text-[9px] text-gray-300 mt-3">
              支持 PDF、EPUB、MOBI、AZW3，最大 {{ maxFileSizeLabel }}
            </p>
          </template>

          <template v-else>
            <div class="text-3xl mb-3">&#128214;</div>
            <p v-if="selectedFiles.length === 1" class="text-sm font-serif font-bold text-black">{{ selectedFiles[0].name }}</p>
            <p v-else class="text-sm font-serif font-bold text-black">已选择 {{ selectedFiles.length }} 个文件</p>
            <p class="text-[10px] text-gray-400 mt-1">{{ selectedFilesSizeLabel }}</p>
            <button
              class="mt-3 text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-red-500 transition-colors"
              @click.stop="clearFiles"
            >
              移除文件
            </button>
          </template>
        </div>

        <!-- 元数据字段 -->
        <div v-if="isSingleFileMode" class="space-y-1">
          <label class="text-[10px] font-bold uppercase tracking-widest text-gray-400">书名 (可选)</label>
          <input
            type="text"
            v-model="title"
            :placeholder="inferredTitle || '自动从文件名推断'"
            class="w-full border-b border-gray-200 py-2 focus:outline-none focus:border-black transition-colors"
          />
        </div>

        <div v-if="isSingleFileMode" class="space-y-1">
          <label class="text-[10px] font-bold uppercase tracking-widest text-gray-400">作者，逗号分隔 (可选)</label>
          <input
            type="text"
            v-model="authorsString"
            placeholder="如：刘慈欣"
            class="w-full border-b border-gray-200 py-2 focus:outline-none focus:border-black transition-colors"
          />
        </div>

        <div v-if="isSingleFileMode" class="space-y-1">
          <label class="text-[10px] font-bold uppercase tracking-widest text-gray-400">ISBN (可选)</label>
          <input
            type="text"
            v-model="isbn"
            class="w-full border-b border-gray-200 py-2 focus:outline-none focus:border-black transition-colors"
          />
        </div>

        <!-- 封面 URL -->
        <CoverUrlInput v-if="isSingleFileMode" v-model="coverUrl" />

        <!-- 同名文件处理策略 -->
        <div class="space-y-2">
          <label class="text-[10px] font-bold uppercase tracking-widest text-gray-400">同名文件处理</label>
          <div class="flex gap-4">
            <label
              v-for="opt in conflictOptions"
              :key="opt.value"
              class="flex items-center gap-2 cursor-pointer group"
            >
              <input
                type="radio"
                v-model="conflictPolicy"
                :value="opt.value"
                class="w-3 h-3 accent-black"
              />
              <span class="text-xs text-gray-500 group-hover:text-black transition-colors">{{ opt.label }}</span>
            </label>
          </div>
        </div>

        <div v-if="selectedFiles.length > 1" class="text-[10px] text-gray-400 leading-relaxed">
          批量导入只负责创建书籍与保存文件。导入完成后，可在书架中选中书籍并使用批量刮削电子书。
        </div>

        <div v-if="importItems.length > 0" class="border-t border-gray-100 pt-5 space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-serif">导入结果</h3>
            <span class="text-[10px] uppercase tracking-widest text-gray-400">{{ importedSummary }}</span>
          </div>

          <div
            v-for="item in importItems"
            :key="item.localId"
            class="border border-gray-100 p-3 space-y-3"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="text-xs font-bold truncate">{{ item.book?.title || item.originalFileName }}</p>
                <p class="text-[10px] text-gray-400 truncate">{{ item.originalFileName }}</p>
              </div>
              <span class="shrink-0 text-[9px] font-bold uppercase tracking-widest" :class="statusClass(item.metadataStatus)">
                {{ metadataStatusLabel(item.metadataStatus) }}
              </span>
            </div>

            <p v-if="item.importStatus === 'failed'" class="text-[10px] text-red-500">{{ item.error }}</p>

            <p v-else class="text-[10px] text-gray-400">已导入，可关闭弹窗后在书架中批量刮削。</p>
          </div>
        </div>
      </div>

      <!-- 底部按钮 -->
      <div class="border-t border-gray-100 pt-6 mt-6">
        <button
          data-testid="import-submit"
          type="button"
          @click="submit"
          :disabled="selectedFiles.length === 0 || submitting || capabilitiesLoading || !importCapabilities"
          class="w-full bg-black text-white py-4 text-xs font-bold uppercase tracking-[0.2em] hover:bg-gray-800 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          {{ submitting ? '导入中...' : selectedFiles.length > 1 ? '批量导入到书架' : '导入到书架' }}
        </button>
        <p v-if="errorMsg" class="text-red-500 text-xs mt-3 text-center">{{ errorMsg }}</p>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import type { BatchImportBookResultItem } from '../../features/library/model/library';
import { ref, computed, watch } from 'vue';
import CoverUrlInput from './CoverUrlInput.vue';
import { useImportCapabilities } from '../../features/library/web/useImportCapabilities';
import type { MetadataStatus } from '../../features/library/model/library';
import { formatFileSize } from '../../utils/fileSize';

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

const dragZoneClass = computed(() => {
  if (selectedFiles.value.length === 0 && dragActive.value) {
    return 'border-black bg-gray-50';
  }
  if (selectedFiles.value.length > 0) {
    return 'border-black bg-gray-50/50';
  }
  return 'border-gray-200 hover:border-gray-400';
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

const statusClass = (status: MetadataStatus): string => {
  if (status === 'applied') return 'text-emerald-600';
  if (status === 'failed') return 'text-red-500';
  if (status === 'candidates_found') return 'text-black';
  if (status === 'scraping') return 'text-blue-600';
  return 'text-gray-400';
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
.slide-enter-active, .slide-leave-active { transition: transform 0.5s ease; }
.slide-enter-from, .slide-leave-to { transform: translateX(100%); }
</style>
