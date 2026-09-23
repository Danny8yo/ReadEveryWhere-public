<template>
  <Transition name="slide">
    <div v-if="isOpen && book" class="fixed inset-y-0 right-0 w-full max-w-xl bg-white shadow-2xl z-50 p-4 md:p-12 flex flex-col justify-between overflow-y-auto">
      
      <!-- 头部 -->
      <div class="flex justify-between items-center mb-8">
        <h2 class="text-xl font-serif">维护书籍信息</h2>
        <button @click="$emit('close')" class="text-xs font-bold uppercase tracking-widest hover:text-gray-500">
          Close [x]
        </button>
      </div>

      <!-- 表单 (可编辑 + 只读) -->
      <div class="flex-1 overflow-y-auto pr-4 space-y-6 custom-scrollbar">
        <!-- 可编辑字段 -->
        <div class="space-y-1">
          <label class="text-[10px] font-bold uppercase tracking-widest text-gray-400">书名</label>
          <input type="text" v-model="formData.title" class="w-full border-b border-gray-200 py-2 focus:outline-none focus:border-black" />
        </div>
        
        <div class="space-y-1">
          <label class="text-[10px] font-bold uppercase tracking-widest text-gray-400">作者 (以逗号分割)</label>
          <input type="text" v-model="authorsString" class="w-full border-b border-gray-200 py-2 focus:outline-none focus:border-black" />
        </div>

        <div class="space-y-1">
          <label class="text-[10px] font-bold uppercase tracking-widest text-gray-400">简介</label>
          <textarea v-model="formData.description" rows="4" class="w-full border border-gray-200 p-2 focus:outline-none focus:border-black text-sm"></textarea>
        </div>

        <!-- 封面设置 -->
        <CoverUrlInput v-model="formData.coverUrl" />

        <!-- 灰底只读字段 (PRD要求) -->
        <div class="bg-gray-50 p-4 space-y-4 text-xs mt-8">
          <div>
            <span class="text-gray-400 font-bold uppercase tracking-widest text-[9px]">ISBN</span>
            <p class="text-gray-600">{{ book.isbn || 'N/A' }}</p>
          </div>
          <div>
            <span class="text-gray-400 font-bold uppercase tracking-widest text-[9px]">文件路径</span>
            <p class="text-gray-600 font-mono text-[10px]">{{ book.fileName || 'N/A' }}</p>
          </div>
          <div>
            <span class="text-gray-400 font-bold uppercase tracking-widest text-[9px]">来源平台</span>
            <p class="text-gray-600">{{ book.sourcePlatform }}</p>
          </div>
        </div>
      </div>

      <!-- 底部按钮 -->
      <div class="border-t border-gray-100 pt-6 mt-6">
        <button 
          @click="save"
          class="w-full bg-black text-white py-4 text-xs font-bold uppercase tracking-[0.2em] hover:bg-gray-800 transition-colors"
        >
          保存更改
        </button>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import type { LibraryBook } from '../../features/library/model/library';
import CoverUrlInput from './CoverUrlInput.vue';

const props = defineProps<{
  isOpen: boolean;
  book: LibraryBook | null;
}>();

const emit = defineEmits<{
  close: [];
  save: [book: LibraryBook];
}>();

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

<style scoped>
.slide-enter-active, .slide-leave-active { transition: transform 0.5s ease; }
.slide-enter-from, .slide-leave-to { transform: translateX(100%); }
</style>
