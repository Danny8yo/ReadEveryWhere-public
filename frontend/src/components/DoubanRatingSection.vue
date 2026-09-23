<template>
  <section class="douban-rating" aria-label="豆瓣评分">
    <div class="douban-rating__summary">
      <div>
        <span>豆瓣评分</span>
        <strong>{{ ratingText }}</strong>
        <small v-if="ratingCountText">{{ ratingCountText }}</small>
      </div>
      <button type="button" @click="openSearch">
        {{ rating ? '重新抓取' : '查看豆瓣评分' }}
      </button>
    </div>

    <div v-if="showSearch" class="douban-rating__search">
      <div class="douban-rating__searchbar">
        <input
          v-model="query"
          type="search"
          placeholder="输入书名查询豆瓣评分"
          @keyup.enter="search"
        />
        <button type="button" :disabled="loading" @click="search">
          {{ loading ? '查询中' : '查询' }}
        </button>
      </div>
      <p v-if="error" class="douban-rating__message" role="alert">{{ error }}</p>
      <p v-else-if="loading" class="douban-rating__message">正在查询豆瓣评分...</p>
      <p v-else-if="searched && candidates.length === 0" class="douban-rating__message">没有找到匹配候选</p>
      <div v-if="candidates.length > 0" class="douban-rating__list">
        <button
          v-for="candidate in candidates"
          :key="candidate.sourceBookId"
          type="button"
          :disabled="saving"
          @click="select(candidate)"
        >
          <span class="douban-rating__title">{{ candidate.title || '未知书名' }}</span>
          <span class="douban-rating__meta">
            {{ candidate.authors.join(', ') || '未知作者' }} ·
            {{ candidate.publisher || '未知出版社' }} ·
            {{ candidate.publishYear ?? '未知年份' }}
          </span>
          <span class="douban-rating__candidate-score">
            {{ candidate.rating?.toFixed(1) ?? '暂无评分' }}
            <small>{{ formatCount(candidate.ratingCount) }}</small>
          </span>
        </button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useDoubanRating } from '../features/metadata/web/useDoubanRating';
import type { DoubanRatingCandidate } from '../features/metadata/model/metadata';

type RatingValue = Pick<
  DoubanRatingCandidate,
  'sourceBookId' | 'sourceUrl' | 'title' | 'rating' | 'ratingCount'
> & { fetchedAt?: string };

const props = defineProps<{
  initialRating?: RatingValue | null;
  defaultQuery: string;
  persistSelection?: (candidate: DoubanRatingCandidate) => Promise<RatingValue>;
}>();
const emit = defineEmits<{ selected: [candidate: DoubanRatingCandidate] }>();

const { rating, showSearch, query, loading, saving, searched, error, candidates, openSearch, search, select } = useDoubanRating(props, candidate => emit('selected', candidate));

const ratingText = computed(() => typeof rating.value?.rating === 'number'
  ? rating.value.rating.toFixed(1)
  : '暂无');
const ratingCountText = computed(() => formatCount(rating.value?.ratingCount ?? null));

const formatCount = (count: number | null) => (
  typeof count === 'number' && count > 0 ? `${count.toLocaleString()} 人评价` : ''
);

</script>

<style scoped>
.douban-rating { border-top: 1px solid #e5e7eb; padding-top: 0.9rem; }
.douban-rating__summary { display: flex; align-items: end; justify-content: space-between; gap: 1rem; }
.douban-rating__summary > div { display: grid; grid-template-columns: auto auto; align-items: baseline; gap: 0.2rem 0.75rem; }
.douban-rating__summary span { color: #6b7280; font-size: 0.7rem; font-weight: 700; }
.douban-rating__summary strong { font-family: Georgia, serif; font-size: 1.8rem; }
.douban-rating__summary small { grid-column: 1 / -1; color: #9ca3af; font-size: 0.66rem; }
.douban-rating__summary button,
.douban-rating__searchbar button {
  min-height: 2.35rem;
  border: 1px solid #111827;
  padding: 0.55rem 0.8rem;
  background: #fff;
  color: #111827;
  font-size: 0.72rem;
  font-weight: 700;
}
.douban-rating__search { margin-top: 0.9rem; }
.douban-rating__searchbar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.5rem; }
.douban-rating__searchbar input { min-width: 0; border: 1px solid #d1d5db; padding: 0.65rem 0.75rem; font-size: 0.8rem; }
.douban-rating__message { margin: 0.65rem 0 0; color: #6b7280; font-size: 0.72rem; }
.douban-rating__list { margin-top: 0.65rem; border-block: 1px solid #e5e7eb; }
.douban-rating__list > button { width: 100%; display: grid; gap: 0.2rem; padding: 0.75rem; border-bottom: 1px solid #e5e7eb; background: #fff; text-align: left; }
.douban-rating__list > button:hover { background: #f9fafb; }
.douban-rating__title { font-size: 0.8rem; font-weight: 700; }
.douban-rating__meta { color: #6b7280; font-size: 0.68rem; }
.douban-rating__candidate-score { font-size: 0.75rem; font-weight: 700; }
.douban-rating__candidate-score small { color: #9ca3af; font-weight: 400; }
@media (max-width: 640px) {
  .douban-rating__summary { align-items: stretch; flex-direction: column; }
  .douban-rating__summary button { width: 100%; }
}
</style>
