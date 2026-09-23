<template>
  <div v-if="isOpen" class="fixed inset-0 z-[120] bg-black/25 p-3 md:p-8" role="dialog" aria-modal="true" aria-labelledby="batch-metadata-title">
    <div class="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden bg-white shadow-2xl">
      <header class="flex items-start justify-between gap-6 border-b border-gray-100 px-5 py-4 md:px-8 md:py-6">
        <div class="min-w-0">
          <p class="text-[10px] font-bold uppercase text-gray-400">{{ providerLabel }} · {{ books.length }} 本</p>
          <h2 id="batch-metadata-title" class="mt-1 font-serif text-xl">批量元数据审核</h2>
          <p data-testid="batch-metadata-summary" class="mt-2 text-xs text-gray-500">
            可应用 {{ acceptedCount }} · 待确认 {{ reviewCount }} · 已更新 {{ appliedCount }} · 未变化 {{ unchangedCount }} · 无候选 {{ noCandidateCount }} · 失败 {{ failedCount }}
          </p>
        </div>
        <button type="button" aria-label="关闭批量元数据审核" title="关闭" class="h-9 w-9 shrink-0 text-xl text-gray-400 hover:text-black disabled:cursor-not-allowed disabled:text-gray-200" :disabled="busy" @click="emit('close')">×</button>
      </header>

      <div v-if="collecting" class="h-1 bg-gray-100" aria-label="候选检索进度">
        <div class="h-full bg-black transition-all" :style="{ width: `${progressPercent}%` }" />
      </div>

      <div class="grid min-h-0 flex-1 md:grid-cols-[minmax(230px,0.34fr)_minmax(0,1fr)]">
        <nav class="min-h-0 overflow-y-auto border-b border-gray-100 md:border-b-0 md:border-r" aria-label="批量刮削书籍">
          <button
            v-for="entry in entries"
            :key="entry.book.id"
            type="button"
            class="flex w-full items-start gap-3 border-b border-gray-100 px-4 py-3 text-left hover:bg-gray-50"
            :class="activeEntry?.book.id === entry.book.id ? 'bg-gray-50' : ''"
            @click="activeBookId = entry.book.id"
          >
            <img :src="entry.book.coverUrl || '/placeholder-cover.png'" class="h-14 w-10 shrink-0 object-cover" alt="" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-xs font-bold">{{ entry.book.title }}</span>
              <span class="mt-1 block text-[10px] text-gray-400">{{ entryStatusLabel(entry) }}</span>
            </span>
          </button>
        </nav>

        <section v-if="activeEntry" class="min-h-0 overflow-y-auto px-5 py-5 md:px-8 md:py-6">
          <div class="border-b border-gray-100 pb-4">
            <p class="text-[9px] font-bold uppercase text-gray-400">当前书籍</p>
            <h3 class="mt-1 text-base font-bold">{{ activeEntry.book.title }}</h3>
            <p class="mt-1 text-xs text-gray-500">{{ activeEntry.book.authors.join(', ') || '作者未知' }}</p>
            <p v-if="activeEntry.book.isbn" class="mt-1 text-[10px] text-gray-400">ISBN {{ activeEntry.book.isbn }}</p>
          </div>

          <div v-if="provider !== 'AI'" class="mt-4 flex items-end gap-3">
            <label class="min-w-0 flex-1 text-[9px] font-bold uppercase text-gray-400">
              检索关键词
              <input v-model="activeEntry.keyword" data-testid="retry-keyword" class="mt-1 w-full border-b border-gray-200 py-2 text-sm normal-case text-black outline-none focus:border-black" />
            </label>
            <button type="button" data-testid="retry-candidate-search" class="shrink-0 border border-gray-200 px-4 py-2 text-[10px] font-bold hover:border-black disabled:text-gray-300" :disabled="busy || !activeEntry.keyword.trim()" @click="retryActive">重新检索</button>
          </div>

          <p v-if="activeEntry.error" class="mt-4 text-xs text-red-600">{{ activeEntry.error }}</p>
          <p v-else-if="activeEntry.status === 'unchanged'" class="mt-4 text-xs text-gray-500">未更新：{{ activeEntry.resultNote }}</p>
          <p v-else-if="activeEntry.status === 'no_candidates'" class="mt-4 text-xs text-gray-500">当前关键词没有返回候选。</p>
          <p v-else-if="activeEntry.status === 'searching' || activeEntry.status === 'pending'" class="mt-4 text-xs text-gray-400">正在检索候选...</p>

          <div v-if="activeEntry.candidates.length > 0" class="mt-5 space-y-3">
            <button
              v-for="(item, index) in activeEntry.candidates"
              :key="`${item.candidate.sourcePlatform}:${item.candidate.sourceBookId}`"
              type="button"
              class="grid w-full grid-cols-[48px_minmax(0,1fr)] gap-4 border p-3 text-left transition-colors"
              :class="activeEntry.selectedIndex === index ? 'border-black bg-gray-50' : 'border-gray-100 hover:border-gray-300'"
              @click="selectCandidate(index)"
            >
              <img :src="item.candidate.coverUrl || '/placeholder-cover.png'" class="h-16 w-12 object-cover" alt="" />
              <span class="min-w-0">
                <span class="flex flex-wrap items-start justify-between gap-2">
                  <strong class="min-w-0 text-sm">{{ item.candidate.title }}</strong>
                  <span class="shrink-0 text-[9px] font-bold" :class="matchLevelClass(item.match.level)">{{ matchLevelLabel(item.match.level) }}</span>
                </span>
                <span class="mt-1 block text-[10px] text-gray-500">{{ item.candidate.authors.join(', ') || '作者未知' }}</span>
                <span class="mt-1 block text-[10px] text-gray-400">
                  {{ [item.candidate.publisher, item.candidate.publishYear, item.candidate.isbn].filter(Boolean).join(' · ') || '无版本信息' }}
                </span>
                <span class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[9px]">
                  <span v-for="signal in item.match.signals" :key="signal" class="text-emerald-700">{{ signalLabel(signal) }}</span>
                  <span v-for="conflict in item.match.conflicts" :key="conflict" class="text-red-600">{{ conflictLabel(conflict) }}</span>
                </span>
              </span>
            </button>
          </div>

          <div v-if="activeEntry.candidates.length > 0 && !isTerminalApplyStatus(activeEntry.status)" class="mt-5 flex flex-wrap gap-3">
            <button type="button" data-testid="confirm-candidate" class="bg-black px-5 py-3 text-[10px] font-bold text-white hover:bg-gray-800" :disabled="busy || activeEntry.selectedIndex === null" @click="confirmActive">确认所选候选</button>
            <button type="button" class="border border-gray-200 px-5 py-3 text-[10px] font-bold hover:border-black" :disabled="busy" @click="skipActive">跳过此书</button>
          </div>

          <p v-if="activeEntry.status === 'applied'" class="mt-5 text-xs text-emerald-700">元数据已应用。</p>
          <p v-else-if="activeEntry.status === 'apply_failed'" class="mt-5 text-xs text-red-600">应用失败：{{ activeEntry.error }}</p>
        </section>

        <div v-else class="flex items-center justify-center p-10 text-sm text-gray-400">没有待处理书籍</div>
      </div>

      <footer class="flex flex-wrap items-center justify-between gap-4 border-t border-gray-100 px-5 py-4 md:px-8">
        <p class="text-[10px] text-gray-400">检索阶段不会修改书籍；只有最终应用时才写入已确认项。</p>
        <button type="button" data-testid="apply-confirmed" class="bg-black px-6 py-3 text-[10px] font-bold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300" :disabled="busy || acceptedCount === 0" @click="applyConfirmed">
          {{ applying ? `应用中 ${applyDone}/${applyTotal}` : `应用已确认的 ${acceptedCount} 本` }}
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { watch } from 'vue';
import type { LibraryBook } from '../../features/library/model/library';
import type { MetadataProvider, MetadataMatchLevel, MetadataMatchSignal, MetadataMatchConflict } from '../../features/metadata/model/metadata';
import type { EntryStatus, ReviewEntry } from '../../features/metadata/domain/batchReview';
import { useBatchMetadataReview } from '../../features/metadata/web/useBatchMetadataReview';
const props = defineProps<{
  isOpen: boolean;
  books: LibraryBook[];
  provider: MetadataProvider;
}>();

const emit = defineEmits<{
  close: [];
  'busy-change': [busy: boolean];
  progress: [done: number, total: number];
  applied: [result: { applied: number; unchanged: number; failed: number }];
}>();

const { entries, activeBookId, collecting, applying, collectDone, applyDone, applyTotal, busy, activeEntry, acceptedCount, reviewCount, appliedCount, unchangedCount, noCandidateCount, failedCount, progressPercent, providerLabel, retryActive, selectCandidate, confirmActive, skipActive, applyConfirmed } = useBatchMetadataReview(props, emit);
function isTerminalApplyStatus(status: EntryStatus) {
  return status === 'applied' || status === 'unchanged' || status === 'applying';
}

function entryStatusLabel(entry: ReviewEntry) {
  return ({
    pending: '等待检索',
    searching: '检索中',
    review: '待确认',
    accepted: '已确认，等待应用',
    no_candidates: '无候选',
    failed: '检索失败',
    skipped: '已跳过',
    applying: '应用中',
    applied: '已应用',
    unchanged: '未变化',
    apply_failed: '应用失败',
  })[entry.status];
}

function matchLevelLabel(level: MetadataMatchLevel) {
  return ({ edition: '同一版本', work: '同一作品', ambiguous: '依据不足', conflict: '存在冲突' })[level];
}

function matchLevelClass(level: MetadataMatchLevel) {
  return level === 'edition' ? 'text-emerald-700' : level === 'work' ? 'text-blue-700' : level === 'ambiguous' ? 'text-amber-700' : 'text-red-600';
}

function signalLabel(signal: MetadataMatchSignal) {
  return ({
    content_derived: '基于当前书籍内容',
    isbn_exact: 'ISBN 一致',
    title_exact: '书名一致',
    title_close: '主标题一致',
    author_overlap: '作者一致',
  })[signal];
}

function conflictLabel(conflict: MetadataMatchConflict) {
  return ({ isbn_mismatch: 'ISBN 冲突', title_mismatch: '书名冲突', author_mismatch: '作者冲突' })[conflict];
}
</script>
