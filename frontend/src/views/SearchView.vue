<template>
  <main class="search-view">
    <section class="search-view__hero">
      <div class="search-view__eyebrow">便携阅读</div>
      <h1 class="search-view__title">随身看.</h1>
      <p class="search-view__subtitle">
        搜索、查看并添加图书到您的私人书库。
      </p>

      <SearchInput v-model="searchQuery" @search="handleSearch" />
      <div class="search-view__filters">
        <FormatFilterMenu :model-value="selectedFormats" @update:model-value="handleFormatChange" />
      </div>
    </section>

    <section v-if="loading" class="search-view__loading">
      <div class="search-view__loading-text">正在搜索资源...</div>
    </section>

    <section v-else-if="searchError" class="search-view__error">
      <div class="search-view__error-card">
        <div class="search-view__status-header">
          <div>
            <p class="search-view__error-title">搜索失败</p>
            <p class="search-view__error-message">{{ searchError.message }}</p>
            <p v-if="searchError.requestId" class="search-view__error-meta">
              请求 ID: {{ searchError.requestId }}
            </p>
          </div>
          <button class="search-view__clear" type="button" @click="clearSearch">
            清空搜索
          </button>
        </div>
      </div>
    </section>

    <section v-else-if="hasResults" class="search-view__results">
      <div class="search-view__results-header">
        <div>
          <h2 class="search-view__section-title">搜索结果 ({{ pagination.total }})</h2>
          <p class="search-view__section-meta">
            第 {{ pagination.page }} 页，共 {{ pagination.totalPages ?? 1 }} 页
          </p>
        </div>
        <button class="search-view__clear" type="button" @click="clearSearch">
          清空搜索
        </button>
      </div>

      <div class="search-view__grid">
        <BookCard
          v-for="book in results"
          :key="book.sourceBookId"
          :book="book"
          @show-detail="openDetail"
        />
      </div>

      <Pagination
        v-if="hasResults && (pagination.totalPages ?? 0) > 1"
        :page="pagination.page"
        :total-pages="pagination.totalPages ?? 1"
        :is-loading="loading"
        aria-label="搜索结果分页"
        @go="goToPage"
      />
    </section>

    <section v-else class="search-view__empty">
      <p>{{ hasSearched ? '没有找到结果。' : '输入关键词开始搜索。' }}</p>
      <button
        v-if="hasSearched"
        class="search-view__clear"
        type="button"
        @click="clearSearch"
      >
        清空搜索
      </button>
    </section>

    <BookDetailModal 
      :is-open="selectedBook !== null" 
      :book="selectedBook" 
      mode="search"
      @close="closeDetail" 
      @douban-rating-selected="handleDoubanRatingSelected"
    />
  </main>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import BookCard from '../components/BookCard.vue';
import BookDetailModal from '../components/BookDetailModal.vue';
import Pagination from '../components/Pagination.vue';
import SearchInput from '../components/SearchInput.vue';
import FormatFilterMenu from '../components/FormatFilterMenu.vue';
import { useSearch } from '../composables/useSearch';
import type { SearchResultItem } from '../features/discovery/model/book';
import type { DoubanRatingCandidate } from '../features/metadata/model/metadata';
import type { EbookFormat } from '../utils/bookFormat';

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

const handleSearch = async (query: string) => {
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
};

const handleDoubanRatingSelected = (bookId: string, rating: DoubanRatingCandidate) => {
  rememberDoubanRating(bookId, rating);
  if (selectedBook.value?.id === bookId) {
    selectedBook.value = { ...selectedBook.value, doubanRating: rating };
  }
};
</script>

<style scoped>
.search-view {
  min-height: 100vh;
  padding: 5rem 2rem 3rem;
  color: #111827;
  background:
    radial-gradient(circle at top left, rgba(243, 244, 246, 0.92), transparent 30%),
    linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
}

.search-view__hero {
  width: min(100%, 80rem);
  margin: 0 auto 5rem;
}

.search-view__filters {
  display: flex;
  justify-content: flex-end;
  margin-top: 1rem;
}

.search-view__endpoint {
  max-width: 48rem;
  margin-bottom: 2rem;
}

.search-view__endpoint-label {
  display: inline-block;
  margin-bottom: 0.5rem;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.22em;
  color: #6b7280;
  text-transform: uppercase;
}

.search-view__endpoint-input {
  width: 100%;
  border: 1px solid rgba(17, 24, 39, 0.12);
  border-radius: 0.95rem;
  background: rgba(255, 255, 255, 0.72);
  padding: 1rem 1.1rem;
  font-size: 0.95rem;
  color: #111827;
  outline: none;
  transition: border-color 0.25s ease, box-shadow 0.25s ease;
}

.search-view__endpoint-input:focus {
  border-color: rgba(17, 24, 39, 0.42);
  box-shadow: 0 0 0 4px rgba(17, 24, 39, 0.06);
}

.search-view__endpoint-hint {
  margin: 0.55rem 0 0;
  color: #9ca3af;
  font-size: 0.82rem;
}

.search-view__eyebrow {
  margin-bottom: 1rem;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.36em;
  color: #9ca3af;
  text-transform: uppercase;
}

.search-view__title {
  margin: 0;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: clamp(3rem, 8vw, 5.5rem);
  line-height: 0.95;
  letter-spacing: -0.04em;
}

.search-view__subtitle {
  max-width: 40rem;
  margin: 1rem 0 2.5rem;
  color: #6b7280;
  font-size: 1rem;
  line-height: 1.8;
}

.search-view__loading,
.search-view__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  width: min(100%, 80rem);
  margin: 0 auto;
  padding: 2.5rem 0;
}

.search-view__loading-text {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 1.1rem;
  color: #6b7280;
}

.search-view__error {
  display: flex;
  justify-content: center;
  width: min(100%, 80rem);
  margin: 0 auto;
  padding: 2rem 0;
}

.search-view__error-card {
  width: min(100%, 36rem);
  border: 1px solid rgba(239, 68, 68, 0.18);
  border-radius: 1.25rem;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(254, 242, 242, 0.72));
  padding: 1.5rem 1.75rem;
  box-shadow: 0 14px 40px rgba(15, 23, 42, 0.06);
}

.search-view__error-title {
  margin: 0 0 0.5rem;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.28em;
  color: #dc2626;
  text-transform: uppercase;
}

.search-view__error-message {
  margin: 0;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 1.1rem;
  line-height: 1.7;
  color: #7f1d1d;
}

.search-view__error-meta {
  margin: 0.9rem 0 0;
  font-size: 0.8rem;
  color: #b91c1c;
}

.search-view__status-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.search-view__results {
  width: min(100%, 80rem);
  margin: 0 auto;
}

.search-view__results-header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.5rem;
  border-bottom: 1px solid rgba(229, 231, 235, 0.9);
  padding-bottom: 1rem;
}

.search-view__section-title {
  margin: 0;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.28em;
  color: #6b7280;
  text-transform: uppercase;
}

.search-view__section-meta {
  margin: 0;
  font-size: 0.82rem;
  color: #9ca3af;
}

.search-view__clear {
  flex-shrink: 0;
  border: 0;
  background: transparent;
  padding: 0;
  color: #9ca3af;
  cursor: pointer;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  transition: color 0.2s ease;
}

.search-view__clear:hover {
  color: #111827;
}

.search-view__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2rem 1.25rem;
}

@media (min-width: 768px) {
  .search-view__grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (min-width: 1200px) {
  .search-view__grid {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
}

.search-view__empty {
  color: #9ca3af;
  font-family: Georgia, 'Times New Roman', serif;
  font-style: italic;
}
</style>
