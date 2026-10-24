<template>
  <article class="book-card" :style="{ '--card-accent': accent }" @click="emit('show-detail', book)">
    <div class="book-card__cover">
      <BookCover :title="book.title" :author="primaryAuthor" :cover-url="book.coverUrl">
        <span v-if="book.formats.length" class="book-card__formats">
          <span v-for="format in book.formats" :key="format">{{ format.toUpperCase() }}</span>
        </span>
      </BookCover>
      <button
        type="button"
        class="book-card__add"
        :aria-label="`加入书架：《${book.title}》`"
        :title="`加入书架：《${book.title}》`"
        @click.stop="emit('quick-add', book)"
      >
        <UiIcon name="plus" :size="18" />
      </button>
    </div>

    <div class="book-card__meta">
      <h3 class="book-card__title">{{ book.title }}</h3>
      <p class="book-card__submeta">
        <span>{{ primaryAuthor }}</span>
        <span v-if="interestScore">推荐 {{ interestScore }}</span>
      </p>
      <p class="book-card__submeta">
        <span>{{ book.publishYear ?? '未知年份' }}</span>
        <span>{{ book.fileSizeText ?? '未知大小' }}</span>
      </p>
    </div>
  </article>
</template>

<script setup lang="ts">
// 采集结果卡片：点卡片看详情，右下角“+”直接加入书架（打开详情并立即开始入库，进度在详情里显示）。
import { computed } from 'vue';
import BookCover from '../../../shared/ui/BookCover.vue';
import UiIcon from '../../../shared/ui/UiIcon.vue';
import { bookAccent } from '../../../shared/utils/coverPalette';
import type { SearchResultItem } from '../../discovery/model/book';

const props = defineProps<{
  book: SearchResultItem;
}>();

const emit = defineEmits<{
  'show-detail': [book: SearchResultItem];
  'quick-add': [book: SearchResultItem];
}>();

const primaryAuthor = computed(() => props.book.authors[0] ?? '未知作者');
const accent = computed(() => bookAccent(props.book.title));
const interestScore = computed(() => {
  const score = props.book.zlibraryInterestScore;
  return typeof score === 'number' && Number.isFinite(score) ? score.toFixed(1) : null;
});
</script>

<style scoped>
.book-card { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; align-content: start; min-width: 0; cursor: pointer; }
.book-card__cover { position: relative; }
.book-card__cover :deep(.book-cover) {
  border-radius: 8px;
  box-shadow: 0 1px 0 var(--ui-line), 0 6px 16px -10px var(--ui-shadow);
  transition: transform 0.25s ease, box-shadow 0.25s ease;
}
@media (hover: hover) {
  .book-card:hover .book-card__cover :deep(.book-cover) {
    transform: translateY(-3px);
    box-shadow: 0 0 0 1px var(--ui-line), 0 18px 40px -10px color-mix(in srgb, var(--card-accent) 85%, transparent);
  }
}
.book-card__formats { position: absolute; left: 7px; top: 7px; z-index: var(--ui-z-raised); display: flex; flex-wrap: wrap; gap: 4px; }
.book-card__formats span { padding: 2px 5px; border-radius: 4px; background: rgba(10, 10, 12, 0.66); color: #fff; font-size: 9px; font-weight: 700; letter-spacing: 0.06em; }
.book-card__add {
  position: absolute;
  right: 7px;
  bottom: 9px;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: #fff;
  color: #111;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
  cursor: pointer;
  transition: transform 0.15s;
}
.book-card__add:hover { transform: scale(1.06); }
.book-card__add:focus-visible { outline: 2px solid var(--ui-fg); outline-offset: 2px; }
/* 单列限定在卡片宽度内：默认 auto 列会被不换行的长书名撑到内容宽度，压到相邻卡片上 */
.book-card__meta { display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; min-width: 0; }
.book-card__title { margin: 0; font-size: 14px; font-weight: 700; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.book-card__submeta { display: flex; justify-content: space-between; gap: 6px; margin: 0; font-size: 12px; color: var(--ui-muted); white-space: nowrap; }
.book-card__submeta span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.book-card__submeta span:last-child { flex-shrink: 0; }
</style>
