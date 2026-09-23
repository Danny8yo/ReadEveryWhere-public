<template>
  <Transition name="slide">
    <div v-if="isOpen" class="fixed inset-y-0 right-0 w-full max-w-xl bg-white shadow-2xl z-50 p-4 md:p-12 flex flex-col justify-between overflow-y-auto">
      
      <!-- 头部 -->
      <div class="flex justify-between items-center mb-8">
        <h2 class="text-xl font-serif">添加书籍</h2>
        <button @click="$emit('close')" class="text-xs font-bold uppercase tracking-widest hover:text-gray-500 transition-colors">
          关闭 [x]
        </button>
      </div>

      <!-- 表单 -->
      <div class="flex-1 overflow-y-auto pr-4 space-y-6 custom-scrollbar">
        <div class="space-y-1">
          <label class="text-[10px] font-bold uppercase tracking-widest text-gray-400">书名 <span class="text-red-500">*</span></label>
          <input type="text" v-model="formData.title" placeholder="如：三体" class="w-full border-b border-gray-200 py-2 focus:outline-none focus:border-black transition-colors" />
        </div>
        
        <div class="space-y-1">
          <label class="text-[10px] font-bold uppercase tracking-widest text-gray-400">作者 (以逗号分割) <span class="text-red-500">*</span></label>
          <input type="text" v-model="authorsString" placeholder="如：刘慈欣" class="w-full border-b border-gray-200 py-2 focus:outline-none focus:border-black transition-colors" />
        </div>

        <div class="space-y-1">
          <label class="text-[10px] font-bold uppercase tracking-widest text-gray-400">封面 URL (可选)</label>
          <input type="text" v-model="formData.coverUrl" placeholder="https://..." class="w-full border-b border-gray-200 py-2 focus:outline-none focus:border-black transition-colors" />
        </div>

        <div class="space-y-1">
          <label class="text-[10px] font-bold uppercase tracking-widest text-gray-400">ISBN (可选)</label>
          <input type="text" v-model="formData.isbn" class="w-full border-b border-gray-200 py-2 focus:outline-none focus:border-black transition-colors" />
        </div>
        
        <div class="space-y-1">
          <label class="text-[10px] font-bold uppercase tracking-widest text-gray-400">出版年份 (可选)</label>
          <input type="number" v-model.number="formData.publishYear" class="w-full border-b border-gray-200 py-2 focus:outline-none focus:border-black transition-colors" />
        </div>

        <div class="space-y-1">
          <label class="text-[10px] font-bold uppercase tracking-widest text-gray-400">简介 (可选)</label>
          <textarea v-model="formData.description" rows="4" class="w-full border border-gray-200 p-2 focus:outline-none focus:border-black text-sm transition-colors mt-2"></textarea>
        </div>
      </div>

      <!-- 底部按钮 -->
      <div class="border-t border-gray-100 pt-6 mt-6">
        <button 
          @click="submit"
          class="w-full bg-black text-white py-4 text-xs font-bold uppercase tracking-[0.2em] hover:bg-gray-800 transition-colors"
        >
          确认添加
        </button>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { AddBookManualParams } from '../../features/library/model/library';

const props = defineProps<{
  isOpen: boolean;
}>();

const emit = defineEmits<{
  close: [];
  save: [book: AddBookManualParams];
}>();

const formData = ref<Partial<AddBookManualParams>>({
  title: '',
  coverUrl: '',
  description: '',
  isbn: '',
  publishYear: undefined,
  authors: [],
});

const authorsString = computed({
  get: () => formData.value.authors?.join(', ') || '',
  set: (val) => {
    formData.value.authors = val.split(',').map(s => s.trim()).filter(Boolean);
  }
});

const submit = () => {
  if (!formData.value.title || !formData.value.authors || formData.value.authors.length === 0) {
    alert('请填写必填项：书名和作者');
    return;
  }
  
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
  formData.value = {
    title: '',
    coverUrl: '',
    description: '',
    isbn: '',
    publishYear: undefined,
    authors: [],
  };
};
</script>

<style scoped>
.slide-enter-active, .slide-leave-active { transition: transform 0.5s ease; }
.slide-enter-from, .slide-leave-to { transform: translateX(100%); }
</style>
