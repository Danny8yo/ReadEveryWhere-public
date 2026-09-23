<template>
  <div v-if="isOpen" class="fixed inset-0 z-[110] flex items-center justify-center bg-black/20 backdrop-blur-sm p-6">
    <div class="bg-white w-full max-w-2xl p-8 shadow-2xl">
      <h2 class="text-xl font-serif mb-6 italic">智能刮削元数据</h2>

      <!-- 搜索表单 -->
      <div v-if="!selectedResult" class="mb-8 space-y-1">
          <label class="text-[9px] uppercase tracking-widest font-bold text-gray-400">元数据来源</label>
          <select v-model="form.provider" class="w-full border-b border-gray-200 py-2 focus:outline-none focus:border-black text-sm">
            <option value="zlibrary">Z-Library</option>
            <option value="douban">豆瓣</option>
            <option value="AI">AI（读取内置书籍）</option>
          </select>
          <label v-if="form.provider !== 'AI'" class="text-[9px] uppercase tracking-widest font-bold text-gray-400">关键词 (必填)</label>
          <input v-if="form.provider !== 'AI'"
          v-model="form.keyword"
          class="w-full border-b border-gray-200 py-2 focus:outline-none focus:border-black text-sm"
          placeholder="支持书名或 ISBN"
        />
        <p v-if="form.provider !== 'AI'" class="text-[10px] text-gray-300">默认使用书名；书名不可用时回退 ISBN 或文件名。</p>
      </div>

      <!-- 搜索按钮 -->
      <button
        v-if="!selectedResult"
        @click="searchMetadata"
        :disabled="isSearching || (form.provider !== 'AI' && !form.keyword.trim())"
        class="w-full bg-black text-white py-4 text-xs font-bold uppercase tracking-widest hover:bg-gray-800 transition-all mb-8 disabled:opacity-40"
      >
        {{ isSearching ? '搜索中...' : '开始检索元数据' }}
      </button>

      <!-- 搜索状态 -->
  <div v-if="isSearching" class="text-center text-xs text-gray-400 mb-4">
        正在查询所选数据源...
      </div>

      <!-- 搜索结果列表 -->
      <div v-if="!selectedResult && results.length > 0" class="max-h-60 overflow-y-auto border-t border-gray-100 pt-4 custom-scrollbar">
        <div
          v-for="res in results"
          :key="res.candidate.sourceBookId"
          @click="previewResult(res)"
          class="flex gap-4 p-3 hover:bg-gray-50 cursor-pointer transition-colors border-b border-gray-50 group"
        >
          <img :src="res.candidate.coverUrl || '/placeholder-cover.png'" class="w-10 h-14 object-cover" />
          <p v-if="error" role="alert" class="text-sm text-red-600">{{ error }}</p>
      <div class="flex-1 min-w-0">
            <p class="text-sm font-bold group-hover:underline truncate">{{ res.candidate.title }}</p>
            <p class="text-[10px] text-gray-400 uppercase tracking-widest">
              {{ res.candidate.authors.join(', ') }}
              <template v-if="res.candidate.publishYear"> · {{ res.candidate.publishYear }}</template>
              <template v-if="res.candidate.publisher"> · {{ res.candidate.publisher }}</template>
            </p>
            <p class="text-[10px] text-gray-300 mt-0.5">{{ matchLevelLabel(res.match.level) }} · 来源: {{ res.candidate.sourcePlatform }}</p>
          </div>
        </div>
      </div>

      <!-- 无结果 -->
      <div v-if="!selectedResult && !isSearching && searchDone && results.length === 0" class="text-center text-xs text-gray-400 py-4">
        未找到匹配的元数据
      </div>

      <!-- 预览面板 -->
      <div v-if="selectedResult" class="space-y-6">
        <div class="flex gap-6">
          <img :src="selectedResult.candidate.coverUrl || '/placeholder-cover.png'" class="w-28 h-40 object-cover shrink-0" />
          <div class="flex-1 min-w-0 space-y-2">
            <h3 class="text-lg font-bold leading-snug">{{ selectedResult.candidate.title }}</h3>
            <p class="text-xs text-gray-500">{{ selectedResult.candidate.authors.join(', ') }}</p>
            <p class="text-[10px] font-bold text-gray-500">{{ matchLevelLabel(selectedResult.match.level) }}</p>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-x-6 gap-y-3 text-xs border-t border-gray-100 pt-4">
          <div v-if="selectedResult.candidate.isbn">
            <span class="text-gray-400 uppercase tracking-widest text-[9px] block mb-0.5">ISBN</span>
            <span>{{ selectedResult.candidate.isbn }}</span>
          </div>
          <div v-if="selectedResult.candidate.publisher">
            <span class="text-gray-400 uppercase tracking-widest text-[9px] block mb-0.5">出版社</span>
            <span>{{ selectedResult.candidate.publisher }}</span>
          </div>
          <div v-if="selectedResult.candidate.publishYear">
            <span class="text-gray-400 uppercase tracking-widest text-[9px] block mb-0.5">出版年份</span>
            <span>{{ selectedResult.candidate.publishYear }}</span>
          </div>
          <div v-if="selectedResult.candidate.language">
            <span class="text-gray-400 uppercase tracking-widest text-[9px] block mb-0.5">语言</span>
            <span>{{ selectedResult.candidate.language }}</span>
          </div>
          <div v-if="selectedResult.candidate.editionTag">
            <span class="text-gray-400 uppercase tracking-widest text-[9px] block mb-0.5">版本</span>
            <span>{{ selectedResult.candidate.editionTag }}</span>
          </div>
          <div>
            <span class="text-gray-400 uppercase tracking-widest text-[9px] block mb-0.5">来源</span>
            <span>{{ selectedResult.candidate.sourcePlatform }}</span>
          </div>
        </div>

        <div v-if="selectedResult.candidate.description" class="border-t border-gray-100 pt-4">
          <span class="text-gray-400 uppercase tracking-widest text-[9px] block mb-2">简介</span>
          <p class="text-xs text-gray-600 leading-relaxed max-h-32 overflow-y-auto custom-scrollbar">{{ selectedResult.candidate.description }}</p>
        </div>

        <div class="flex gap-3 pt-2">
          <button
            @click="applyResult(selectedResult.candidate)"
            class="flex-1 bg-black text-white py-3 text-[10px] font-bold uppercase tracking-widest hover:bg-gray-800 transition-all"
          >
            应用此元数据
          </button>
          <button
            @click="selectedResult = null"
            class="px-6 py-3 border border-gray-200 text-[10px] font-bold uppercase tracking-widest hover:border-black transition-all"
          >
            返回列表
          </button>
        </div>
      </div>

      <div class="mt-8 flex justify-end">
        <button @click="$emit('close')" class="text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-black">取消</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue';
import type { LibraryBook } from '../../features/library/model/library';
import { useSingleMetadata } from '../../features/metadata/web/useSingleMetadata';
import type { MatchedMetadataCandidate, MetadataMatchLevel, ScrapedResult } from '../../features/metadata/model/metadata';
import { buildMetadataScrapeKeyword } from '../../features/metadata/domain/keyword';

const props = defineProps<{
  isOpen: boolean;
  book: LibraryBook | null;
}>();

const emit = defineEmits<{
  close: [];
  apply: [data: ScrapedResult];
}>();

const form = reactive<{ keyword: string; provider: 'zlibrary' | 'douban' | 'AI' }>({ keyword: '', provider: 'zlibrary' });
const { isSearching, results, searchDone, error, search } = useSingleMetadata(() => props.book ? props.book.id : null);
const selectedResult = ref<MatchedMetadataCandidate | null>(null);

watch(() => props.book, (b) => {
  if (b) {
    form.keyword = buildMetadataScrapeKeyword(b);
    form.provider = 'zlibrary';
    results.value = [];
    searchDone.value = false;
    selectedResult.value = null;
  }
}, { immediate: true });

const searchMetadata = async () => {
  const q = form.keyword.trim();
  if (form.provider !== 'AI' && !q) return;

  selectedResult.value = null;
  await search(form.provider, q);
};

const previewResult = (res: MatchedMetadataCandidate) => {
  selectedResult.value = res;
};

const matchLevelLabel = (level: MetadataMatchLevel) => ({
  edition: '同一版本',
  work: '同一作品，版本待确认',
  ambiguous: '匹配依据不足',
  conflict: '存在冲突',
})[level];

const applyResult = (res: ScrapedResult) => {
  emit('apply', res);
  emit('close');
};
</script>
