<template>
  <main class="search-page">
    <div class="search-page__inner">
      <section class="search-ask">
        <h1>想读点什么？</h1>
        <SearchInput v-model="searchQuery" @search="handleSearch" />
        <FormatFilterMenu class="search-ask__formats" :model-value="selectedFormats" @update:model-value="handleFormatChange" />
      </section>

      <!-- 搜索中：封面形状的骨架 -->
      <section v-if="loading" class="search-results" aria-busy="true">
        <p class="search-results__status" role="status">正在搜索资源…</p>
        <div class="search-wall" aria-hidden="true">
          <div v-for="n in 8" :key="n" class="search-skeleton"><i /><i /><i /></div>
        </div>
      </section>

      <section v-else-if="searchError" class="search-state">
        <div class="search-error" role="alert">
          <strong>搜索失败</strong>
          <span>{{ searchError.message }}</span>
          <code v-if="searchError.requestId">请求 ID：{{ searchError.requestId }}</code>
          <div class="search-error__actions">
            <UiButton size="sm" icon="refresh" @click="handleSearch(searchQuery)">重试</UiButton>
            <UiButton size="sm" variant="ghost" @click="clearSearch">清空搜索</UiButton>
          </div>
        </div>
      </section>

      <section v-else-if="hasResults" class="search-results">
        <header class="search-results__head">
          <h2>{{ pagination.total }} 个结果</h2>
          <span>来源 Z-Library · 第 {{ pagination.page }} / {{ pagination.totalPages ?? 1 }} 页</span>
          <span class="search-results__grow" />
          <UiButton size="sm" variant="ghost" icon="close" @click="clearSearch">清空搜索</UiButton>
        </header>

        <div class="search-wall">
          <BookCard
            v-for="book in results"
            :key="book.sourceBookId"
            :book="book"
            @show-detail="openDetail"
            @quick-add="quickAdd"
          />
        </div>

        <Pagination
          v-if="(pagination.totalPages ?? 0) > 1"
          :page="pagination.page"
          :total-pages="pagination.totalPages ?? 1"
          :is-loading="loading"
          aria-label="搜索结果分页"
          @go="goToPage"
        />
      </section>

      <section v-else class="search-state">
        <div class="search-state__ghosts" aria-hidden="true"><i /><i /><i /></div>
        <template v-if="hasSearched">
          <h2>没有找到“{{ lastQuery }}”</h2>
          <p>试试只搜书名，或者放宽格式筛选。</p>
          <UiButton size="sm" @click="clearSearch">清空搜索</UiButton>
        </template>
        <template v-else>
          <h2>从 Z-Library 找书</h2>
          <p>输入书名、作者或关键词开始搜索，找到的书可以直接加入书架。</p>
        </template>
      </section>
    </div>

    <BookDetailModal
      :is-open="selectedBook !== null"
      :book="selectedBook"
      mode="search"
      :auto-add-token="autoAddToken"
      @close="closeDetail"
      @douban-rating-selected="handleDoubanRatingSelected"
    />
  </main>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import UiButton from '../shared/ui/UiButton.vue';
import BookCard from '../features/library/ui/BookCard.vue';
import BookDetailModal from '../features/book-detail/ui/BookDetailModal.vue';
import Pagination from '../shared/ui/Pagination.vue';
import SearchInput from '../features/discovery/ui/SearchInput.vue';
import FormatFilterMenu from '../features/library/ui/FormatFilterMenu.vue';
import { useSearch } from '../features/discovery/web/useSearch';
import type { SearchResultItem } from '../features/discovery/model/book';
import type { DoubanRatingCandidate } from '../features/metadata/model/metadata';
import type { EbookFormat } from '../shared/utils/bookFormat';

const {
  loading,
  results,
  pagination,
  searchQuery,
  searchBooks,
  clearSearch,
  rememberDoubanRating,
  goToPage,
  hasResults,
  hasSearched,
  selectedFormats,
  error: searchError,
} = useSearch();
const selectedBook = ref<SearchResultItem | null>(null);

// 无结果提示里引用的是“上一次真正提交的关键词”，而不是输入框里正在改的内容
const lastQuery = ref('');
const handleSearch = async (query: string) => {
  lastQuery.value = query.trim();
  await searchBooks(query, 1, 20);
};

const handleFormatChange = async (formats: EbookFormat[]) => {
  selectedFormats.value = formats;
  if (hasSearched.value && searchQuery.value.trim()) {
    await searchBooks(searchQuery.value, 1, pagination.value.pageSize);
  }
};

const openDetail = (book: SearchResultItem) => {
  selectedBook.value = book;
};

const closeDetail = () => {
  selectedBook.value = null;
  autoAddToken.value = null;
};

// 卡片上的“+”：打开这本书的详情并立即开始入库。入库流程（防重复提交、下载轮询、失败重试）只在详情里实现一份。
const autoAddToken = ref<number | null>(null);
const quickAdd = (book: SearchResultItem) => {
  selectedBook.value = book;
  autoAddToken.value = Date.now();
};

const handleDoubanRatingSelected = (bookId: string, rating: DoubanRatingCandidate) => {
  rememberDoubanRating(bookId, rating);
  if (selectedBook.value?.id === bookId) {
    selectedBook.value = { ...selectedBook.value, doubanRating: rating };
  }
};
</script>

<style scoped>
.search-page {
  min-height: 100vh;
  padding: 20px clamp(16px, 3vw, 32px) 48px;
  background: var(--ui-bg);
  color: var(--ui-fg);
}
.search-page__inner { max-width: 1240px; margin: 0 auto; }

.search-ask { display: grid; justify-items: center; gap: 16px; padding: 28px 0 8px; text-align: center; }
.search-ask h1 { margin: 0; font-size: clamp(28px, 4.5vw, 40px); font-weight: 900; letter-spacing: -0.01em; }
.search-ask__formats { justify-content: center; max-width: 100%; }
@media (max-width: 640px) {
  .search-ask { justify-items: stretch; padding-top: 16px; }
  .search-ask__formats { justify-content: flex-start; }
}

.search-results { margin-top: 30px; }
.search-results__status { margin: 0 0 14px; font-size: 13px; color: var(--ui-muted); }
.search-results__head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; margin-bottom: 16px; }
.search-results__head h2 { margin: 0; font-size: 18px; font-weight: 900; font-variant-numeric: tabular-nums; }
.search-results__head span { font-size: 12px; color: var(--ui-muted); }
.search-results__grow { flex: 1; }

.search-wall { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 28px 18px; }
@media (max-width: 640px) {
  .search-wall { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 22px 12px; }
}
.search-skeleton { display: grid; gap: 7px; }
.search-skeleton i { display: block; border-radius: 8px; background: linear-gradient(90deg, var(--ui-surface2) 30%, color-mix(in srgb, var(--ui-surface2) 60%, var(--ui-fg) 8%) 50%, var(--ui-surface2) 70%) 0 0 / 300% 100%; animation: search-shimmer 1.6s infinite linear; }
.search-skeleton i:first-child { aspect-ratio: 3 / 4; }
.search-skeleton i:nth-child(2) { height: 12px; width: 80%; }
.search-skeleton i:nth-child(3) { height: 10px; width: 50%; }
@keyframes search-shimmer { to { background-position: -150% 0; } }
@media (prefers-reduced-motion: reduce) { .search-skeleton i { animation: none; } }

.search-state { display: grid; justify-items: center; gap: 10px; margin-top: 40px; padding: 24px 0; text-align: center; }
.search-state h2 { margin: 6px 0 0; font-size: 18px; font-weight: 900; }
.search-state p { margin: 0; max-width: 34ch; font-size: 14px; color: var(--ui-muted); }
.search-state__ghosts { display: flex; align-items: flex-end; gap: 6px; height: 88px; }
.search-state__ghosts i { width: 46px; border-radius: 5px; border: 1.5px dashed color-mix(in srgb, var(--ui-fg) 28%, transparent); }
.search-state__ghosts i:nth-child(1) { height: 62px; transform: rotate(-6deg); }
.search-state__ghosts i:nth-child(2) { height: 80px; }
.search-state__ghosts i:nth-child(3) { height: 70px; transform: rotate(5deg); }

.search-error {
  display: grid;
  gap: 6px;
  width: min(100%, 520px);
  padding: 16px;
  border: 1px solid color-mix(in srgb, var(--ui-err) 35%, transparent);
  border-radius: var(--ui-radius-card);
  background: color-mix(in srgb, var(--ui-err) 10%, var(--ui-surface));
  font-size: 14px;
  text-align: left;
}
.search-error strong { color: var(--ui-err); }
.search-error code { font-size: 12px; color: var(--ui-muted); }
.search-error__actions { display: flex; gap: 8px; margin-top: 6px; }
</style>
