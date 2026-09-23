<template>
  <article class="book-card" @click="emit('show-detail', book)">
    <div class="book-card__cover-wrap">
      <img
        v-if="book.coverUrl"
        class="book-card__cover"
        :src="book.coverUrl"
        :alt="book.title"
      />
      <div v-else class="book-card__cover-fallback">无封面</div>
      <span class="book-card__badge">{{ primaryFormat }}</span>
    </div>

    <div class="book-card__meta">
      <p class="book-card__author">{{ primaryAuthor }}</p>
      <h3 class="book-card__title">{{ book.title }}</h3>
      <p class="book-card__submeta">
        <span>{{ book.publishYear ?? '未知年份' }}</span>
        <span>{{ book.fileSizeText ?? '未知大小' }}</span>
      </p>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { SearchResultItem } from '../features/discovery/model/book';

const props = defineProps<{
  book: SearchResultItem;
}>();

const emit = defineEmits<{
  'show-detail': [book: SearchResultItem];
}>();

const primaryAuthor = computed(() => props.book.authors[0] ?? '未知作者');
const primaryFormat = computed(() => props.book.formats[0] ?? 'other');
</script>

<style scoped>
.book-card {
  cursor: pointer;
  transform: translateY(0);
  transition: transform 0.35s ease, box-shadow 0.35s ease;
}

.book-card:hover {
  transform: translateY(-0.35rem);
}

.book-card__cover-wrap {
  position: relative;
  aspect-ratio: 3 / 4;
  overflow: hidden;
  border-radius: 1rem;
  background: #f3f4f6;
  box-shadow: 0 10px 20px rgba(15, 23, 42, 0.06);
}

.book-card__cover {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.7s ease;
}

.book-card:hover .book-card__cover {
  transform: scale(1.04);
}

.book-card__cover-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: #9ca3af;
  font-family: Georgia, 'Times New Roman', serif;
  font-style: italic;
}

.book-card__badge {
  position: absolute;
  top: 0.75rem;
  right: 0.75rem;
  border-radius: 9999px;
  background: rgba(17, 24, 39, 0.85);
  padding: 0.35rem 0.6rem;
  font-size: 0.65rem;
  line-height: 1;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: #fff;
  text-transform: uppercase;
}

.book-card__meta {
  padding-top: 1rem;
}

.book-card__author {
  margin: 0;
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.22em;
  color: #9ca3af;
  text-transform: uppercase;
}

.book-card__title {
  margin: 0.5rem 0 0;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 0.95rem;
  line-height: 1.45;
  color: #111827;
}

.book-card__submeta {
  display: flex;
  gap: 0.75rem;
  margin: 0.45rem 0 0;
  font-size: 0.75rem;
  color: #6b7280;
}
</style>