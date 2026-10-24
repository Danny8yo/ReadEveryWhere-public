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
import { useDoubanRating } from '../web/useDoubanRating';
import type { DoubanRatingCandidate } from '../model/metadata';

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
/* 封面流：工具层卡片样式，只用 --ui-* 变量 */
.douban-rating { padding: 14px 16px; border: 1px solid var(--ui-line); border-radius: var(--ui-radius-card); background: var(--ui-surface); color: var(--ui-fg); }
.douban-rating__summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.douban-rating__summary > div { display: grid; grid-template-columns: auto auto; align-items: baseline; gap: 2px 10px; }
.douban-rating__summary span { color: var(--ui-muted); font-size: 12px; }
.douban-rating__summary strong { font-size: 26px; font-weight: 900; line-height: 1.1; font-variant-numeric: tabular-nums; }
.douban-rating__summary small { grid-column: 1 / -1; color: var(--ui-muted); font-size: 12px; }
.douban-rating__summary button,
.douban-rating__searchbar button {
  flex: none;
  min-height: 28px;
  padding: 5px 12px;
  border: 1px solid var(--ui-line);
  border-radius: 999px;
  background: var(--ui-surface2);
  color: var(--ui-fg);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
}
.douban-rating__summary button:focus-visible,
.douban-rating__searchbar button:focus-visible { outline: 2px solid var(--ui-fg); outline-offset: 2px; }
.douban-rating__searchbar button:disabled { opacity: 0.45; cursor: not-allowed; }
.douban-rating__search { margin-top: 12px; }
.douban-rating__searchbar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; }
.douban-rating__searchbar input {
  min-width: 0;
  min-height: 36px;
  padding: 6px 12px;
  border: 1px solid var(--ui-line);
  border-radius: var(--ui-radius-control);
  background: var(--ui-surface2);
  color: var(--ui-fg);
  font: inherit;
  font-size: 13px;
  outline: none;
}
.douban-rating__searchbar input:focus-visible { border-color: var(--ui-fg); }
.douban-rating__message { margin: 10px 0 0; color: var(--ui-muted); font-size: 12px; }
.douban-rating__list { display: grid; gap: 6px; margin-top: 10px; }
.douban-rating__list > button {
  width: 100%;
  display: grid;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--ui-line);
  border-radius: 12px;
  background: var(--ui-bg);
  color: var(--ui-fg);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.douban-rating__list > button:hover:not(:disabled) { border-color: var(--ui-fg); }
.douban-rating__list > button:disabled { opacity: 0.6; cursor: wait; }
.douban-rating__title { font-size: 13px; font-weight: 700; }
.douban-rating__meta { color: var(--ui-muted); font-size: 12px; }
.douban-rating__candidate-score { font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
.douban-rating__candidate-score small { margin-left: 4px; color: var(--ui-muted); font-weight: 400; }
</style>
