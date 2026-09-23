<template>
  <div class="flex flex-wrap justify-between items-center gap-5 border-b border-gray-100 pb-6 mb-8">
    <!-- 搜索与状态 -->
    <div class="flex flex-wrap items-center gap-5">
      <div class="relative group">
        <input 
          type="text" 
          :value="searchQuery"
          @input="handleInput"
          placeholder="搜索馆藏..." 
          class="bg-transparent border-none outline-none text-xs font-bold uppercase tracking-widest w-48 placeholder:text-gray-300"
        />
        <div class="absolute bottom-[-4px] left-0 w-0 h-[1px] bg-black transition-all group-focus-within:w-full"></div>
      </div>
      <FormatFilterMenu
        :model-value="selectedFormats"
        @update:model-value="$emit('update:selectedFormats', $event)"
      />
      
      <div class="flex gap-6 text-[10px] font-bold uppercase tracking-widest text-gray-300">
        <span>{{ totalCount }} 个项目</span>
        <span v-if="selectedCount > 0" class="text-black">已选择 {{ selectedCount }} 本</span>
      </div>
    </div>

    <!-- 批量操作与视图切换 -->
    <div class="flex items-center gap-6">
      <div class="flex items-center gap-2">
        <button
          type="button"
          aria-label="批量 AI 预分析"
          :disabled="selectedCount === 0 || isBatchAnalyzing"
          class="text-xs font-bold uppercase tracking-widest transition-colors disabled:cursor-not-allowed"
          :class="selectedCount > 0 && !isBatchAnalyzing ? 'text-gray-500 hover:text-black' : 'text-gray-300'"
          @click="$emit('batch-analyze')"
        >
          {{ isBatchAnalyzing ? 'AI 预分析中' : '批量 AI 预分析' }}
        </button>
        <BookAnalysisHelp />
      </div>

      <select
        v-model="batchProvider"
        aria-label="批量刮削来源"
        class="bg-transparent text-xs font-bold uppercase tracking-widest text-gray-500 outline-none"
      >
        <option value="zlibrary">Z-Library</option>
        <option value="douban">豆瓣</option>
        <option value="AI">AI</option>
      </select>
      <button
        @click="$emit('batch-scrape', batchProvider)"
        :disabled="selectedCount === 0 || isBatchScraping"
        class="text-xs font-bold uppercase tracking-widest transition-colors disabled:cursor-not-allowed"
        :class="selectedCount > 0 && !isBatchScraping ? 'text-gray-400 hover:text-black' : 'text-gray-300'"
      >
        {{ isBatchScraping ? `批量刮削中 ${batchScrapeDone}/${batchScrapeTotal}` : '批量刮削电子书' }}
      </button>

      <button
        v-if="selectedCount > 0"
        @click="$emit('batch-delete')"
        class="text-xs font-bold uppercase tracking-widest text-red-500 hover:text-red-700 transition-colors"
      >
        批量删除
      </button>

      <div class="flex gap-4 text-xs font-bold uppercase tracking-widest border-l border-gray-100 pl-6">
        <button 
          @click="$emit('change-view', 'grid')" 
          :class="viewMode === 'grid' ? 'text-black' : 'text-gray-300'"
        >
          封面墙
        </button>
        <span class="text-gray-200">/</span>
        <button 
          @click="$emit('change-view', 'list')" 
          :class="viewMode === 'list' ? 'text-black' : 'text-gray-300'"
        >
          列表视图
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { ViewMode } from '../../types/library';
import BookAnalysisHelp from '../book-analysis/BookAnalysisHelp.vue';
import FormatFilterMenu from '../FormatFilterMenu.vue';
import type { EbookFormat } from '../../utils/bookFormat';

defineProps<{
  viewMode: ViewMode;
  selectedCount: number;
  totalCount: number;
  searchQuery: string;
  selectedFormats: EbookFormat[];
  isBatchScraping?: boolean;
  batchScrapeDone?: number;
  batchScrapeTotal?: number;
  isBatchAnalyzing?: boolean;
}>();

const emit = defineEmits<{
  'change-view': [mode: ViewMode];
  'batch-delete': [];
  'batch-scrape': [provider: 'zlibrary' | 'douban' | 'AI'];
  'batch-analyze': [];
  'update:searchQuery': [query: string];
  'update:selectedFormats': [formats: EbookFormat[]];
}>();

const batchProvider = ref<'zlibrary' | 'douban' | 'AI'>('zlibrary');

const handleInput = (e: Event) => {
  const target = e.target as HTMLInputElement;
  emit('update:searchQuery', target.value);
};
</script>
