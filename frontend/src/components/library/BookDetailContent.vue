<template>
  <Transition name="fade">
    <div v-if="isOpen && book" class="detail-modal" @click.self="emit('close')">
      <div class="detail-modal__panel">
        <div class="detail-modal__cover-wrap">
          <img
            v-if="book.coverUrl"
            class="detail-modal__cover"
            :src="book.coverUrl"
            :alt="book.title"
          />
          <div v-else class="detail-modal__cover-fallback">无封面</div>
        </div>

        <div class="detail-modal__content">
          <div class="detail-modal__header">
            <p class="detail-modal__kicker">{{ book.sourcePlatform }}</p>
            <button class="detail-modal__close" type="button" @click="emit('close')">关闭 [x]</button>
          </div>

          <div class="detail-modal__scroll">
            <div class="detail-modal__heading">
              <h2 class="detail-modal__title">{{ book.title }}</h2>
              <div class="detail-modal__meta">
                <span>{{ primaryAuthor }}</span>
                <span>{{ book.publishYear ?? '未知年份' }}</span>
                <span>ISBN: {{ displayIsbn || '未提供' }}</span>
                <span>{{ book.fileSizeText ?? '未知大小' }}</span>
                <span v-if="book.formats && book.formats.length">格式: {{ book.formats.join(', ').toUpperCase() }}</span>
              </div>
              <section v-if="mode === 'library'" class="detail-modal__profile-summary">
                <div>
                  <span>阅读画像</span>
                  <strong>{{ profileSummaryLabel }}</strong>
                  <small>{{ profileConfidenceLabel }}</small>
                </div>
                <BookAnalysisStatus :status="analysisStatus" />
                <button type="button" @click="profileDrawerOpen = true">查看与编辑画像</button>
              </section>
              <div class="detail-modal__scores">
                <div class="detail-modal__score">
                  <template v-if="mode === 'search'">
                  <span class="detail-modal__score-label">zlibrary 推荐值</span>
                  <strong>{{ zlibraryInterestScoreText }}</strong>
                  </template>
                </div>
                <DoubanRatingSection
                  class="detail-modal__douban"
                  :initial-rating="book.doubanRating"
                  :default-query="book.title"
                  :persist-selection="mode === 'library' ? persistDoubanSelection : undefined"
                  @selected="handleDoubanSelected"
                />
              </div>
            </div>

            <div class="detail-modal__description" v-html="safeDescription"></div>
          </div>

          <p v-if="detailError" role="alert" class="px-6 py-2 text-sm text-red-600">{{ detailError }}</p>
          <p v-if="acquisitionError" role="alert" class="px-6 py-2 text-sm text-red-600">{{ acquisitionError }}</p>
          <div class="detail-modal__actions">
            <!-- 搜索模式：显示“加入书架” -->
            <button 
              v-if="mode === 'search'" 
              class="detail-modal__primary" 
              type="button" 
              :disabled="isCurrentBookAdding"
              @click="handleAddToLibrary"
            >
              {{ addButtonLabel }}
            </button>

            <!-- 书架模式：显示“开始阅读” -->
            <button 
              v-if="mode === 'library'" 
              class="detail-modal__primary" 
              type="button" 
              @click="handleRead"
            >
              开始阅读
            </button>

            <button
              v-if="mode === 'search' && book.readOnlineAvailable && book.readOnlineUrl"
              class="detail-modal__secondary"
              type="button"
              @click="openOnlineUrl(book.readOnlineUrl)"
            >
              在线阅读
            </button>

            <button
              v-if="mode === 'search' && book.downloadPath && zlibraryBaseUrl"
              class="detail-modal__secondary"
              type="button"
              @click="openDownloadUrl"
            >
              下载到本机
            </button>
          </div>
        </div>
        <ReadingProfileDrawer
          v-if="mode === 'library' && libraryBookId"
          :open="profileDrawerOpen"
          :book="book"
          :library-book-id="libraryBookId"
          @close="profileDrawerOpen = false"
          @analyze="emit('analyze', $event)"
          @profile-updated="emit('profileUpdated', $event)"
        />
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import sanitizeHtml from 'sanitize-html';
import type { BookDetailModel } from '../../shared/model/bookDetail';
import type { DoubanRatingCandidate } from '../../features/metadata/model/metadata';
import BookAnalysisStatus from '../book-analysis/BookAnalysisStatus.vue';
import type { BookAnalysisStatus as BookAnalysisStatusValue } from '../../features/metadata/model/bookAnalysis';
import type { FormalBookReadingProfile } from '../../features/metadata/model/bookAnalysis';
import DoubanRatingSection from '../DoubanRatingSection.vue';
import ReadingProfileDrawer from '../book-analysis/ReadingProfileDrawer.vue';
import { genreDisplayLabel } from '../../features/metadata/domain/analysisState';

const props = withDefaults(defineProps<{
  isOpen: boolean;
  book: BookDetailModel | null;
  mode?: 'search' | 'library';
  libraryBookId?: number;
  acquisition: { busy:boolean; label:string; error:string|null };
  detail: { baseUrl:string|null; error:string|null };
  persistDoubanSelection:(candidate:DoubanRatingCandidate)=>Promise<DoubanRatingCandidate>;
}>(), {
  mode: 'search'
});

const emit = defineEmits<{
  close: [];
  add: [];
  read: [book: BookDetailModel];
  doubanRatingSelected: [bookId: string, rating: DoubanRatingCandidate];
  analyze: [payload: { bookId: number; force: boolean }];
  profileUpdated: [profile: FormalBookReadingProfile];
}>();

const zlibraryBaseUrl = computed(() => props.detail.baseUrl);
const detailError = computed(() => props.detail.error);
const persistDoubanSelection = (candidate:DoubanRatingCandidate) => props.persistDoubanSelection(candidate);
const profileDrawerOpen = ref(false);
const isCurrentBookAdding = computed(() => props.acquisition.busy);
const addButtonLabel = computed(() => props.acquisition.label);
const acquisitionError = computed(() => props.acquisition.error);
const handleAddToLibrary = () => emit('add');

const primaryAuthor = computed(() => props.book?.authors.join(', ') || '未知作者');
const displayIsbn = computed(() => props.book?.identifier || props.book?.isbn || null);
const bookAnalysis = computed(() => props.book?.bookAnalysis ?? null);
const analysisStatus = computed<BookAnalysisStatusValue>(() => bookAnalysis.value?.status ?? 'not_analyzed');
const profileSummaryLabel = computed(() => props.book?.readingProfile?.primaryGenre
  ? genreDisplayLabel(props.book.readingProfile.primaryGenre)
  : '未设置');
const profileConfidenceLabel = computed(() => {
  const confidence = props.book?.readingProfile?.confidence;
  if (confidence?.kind === 'user-determined') return '用户自行判定';
  if (confidence?.kind === 'ai-score' && confidence.score !== null) return `${Math.round(confidence.score * 100)}%`;
  return '未设置';
});

const zlibraryInterestScoreText = computed(() => {
  const score = props.book?.zlibraryInterestScore;
  return typeof score === 'number' && Number.isFinite(score) ? score.toFixed(1) : '暂无';
});


const safeDescription = computed(() => {
  const raw = props.book?.description || '暂无简介';
  return sanitizeHtml(raw, {
    allowedTags: ['b', 'i', 'em', 'strong', 'p', 'br'],
    allowedAttributes: {},
  });
});

const downloadUrl = computed(() => {
  if (!props.book?.downloadPath || !zlibraryBaseUrl.value) return '#';
  return `${zlibraryBaseUrl.value.replace(/\/$/, '')}${props.book.downloadPath}`;
});

watch(() => props.isOpen, (open) => {
  if (!open) profileDrawerOpen.value = false;
});

const handleDoubanSelected = (candidate: DoubanRatingCandidate) => {
  if (props.mode === 'search' && props.book) emit('doubanRatingSelected', props.book.id, candidate);
};

const handleRead = () => {
  if (props.book) {
    emit('read', props.book);
  }
};

const openOnlineUrl = (url: string) => {
  window.open(url, '_blank');
};

const openDownloadUrl = () => {
  if (downloadUrl.value && downloadUrl.value !== '#') {
    window.open(downloadUrl.value, '_blank');
  }
};
</script>

<style scoped>
.detail-modal {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(14px);
}

.detail-modal__panel {
  display: grid;
  width: min(100%, 84rem);
  height: min(90vh, 52rem);
  grid-template-columns: 1fr;
  gap: 1.25rem;
  overflow: hidden;
}

@media (min-width: 768px) {
  .detail-modal__panel {
    grid-template-columns: minmax(18rem, 0.78fr) minmax(0, 1.22fr);
    gap: 2rem;
  }
}

.detail-modal__cover-wrap {
  align-self: start;
  width: min(100%, 19rem);
  max-height: 34vh;
  margin: 0 auto;
  aspect-ratio: 3 / 4;
  overflow: hidden;
  border-radius: 0.75rem;
  background: #f3f4f6;
  box-shadow: 0 18px 42px rgba(15, 23, 42, 0.16);
}

.detail-modal__cover,
.detail-modal__cover-fallback {
  width: 100%;
  height: 100%;
}

.detail-modal__cover {
  object-fit: cover;
}

.detail-modal__cover-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9ca3af;
  font-family: Georgia, 'Times New Roman', serif;
  font-style: italic;
}

.detail-modal__content {
  min-height: 0;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(229, 231, 235, 0.85);
  border-radius: 0.75rem;
  background: rgba(255, 255, 255, 0.88);
  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.08);
}

.detail-modal__header {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  border-bottom: 1px solid rgba(229, 231, 235, 0.82);
  padding: 0.95rem 1.1rem 0.8rem;
}

.detail-modal__scroll {
  min-height: 0;
  flex: 1 1 auto;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 1.15rem 1.1rem 1.25rem;
  scrollbar-gutter: stable;
}

.detail-modal__close {
  border: 0;
  background: transparent;
  padding: 0;
  flex: 0 0 auto;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: #111827;
  cursor: pointer;
}

.detail-modal__kicker {
  margin: 0;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.24em;
  color: #9ca3af;
  text-transform: uppercase;
}

.detail-modal__title {
  margin: 0;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: clamp(1.55rem, 2.2vw, 2.55rem);
  line-height: 1.16;
  color: #111827;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.detail-modal__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1rem;
  margin-top: 0.9rem;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: #6b7280;
  text-transform: uppercase;
}

.detail-modal__profile-summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 1rem;
  margin-top: 1.1rem;
  border-block: 1px solid #e5e7eb;
  padding: 0.9rem 0;
}
.detail-modal__profile-summary > div { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem; }
.detail-modal__profile-summary span,
.detail-modal__profile-summary small { color: #6b7280; font-size: 0.68rem; font-weight: 700; }
.detail-modal__profile-summary strong { font: 1rem Georgia, serif; }
.detail-modal__profile-summary > button { min-height: 2.35rem; border: 1px solid #111827; padding: 0.5rem 0.75rem; font-size: 0.7rem; font-weight: 700; }

.detail-modal__meta span + span::before {
  content: '|';
  margin-right: 1rem;
  color: #e5e7eb;
}

.detail-modal__scores {
  display: grid;
  grid-template-columns: auto minmax(16rem, 1fr);
  gap: 1rem;
  margin-top: 1rem;
}
.detail-modal__score:empty { display: none; }
.detail-modal__douban { min-width: 0; }

.detail-modal__score {
  display: flex;
  align-items: baseline;
  gap: 0.45rem;
  border-bottom: 1px solid rgba(17, 24, 39, 0.12);
  padding-bottom: 0.35rem;
}

.detail-modal__score-label {
  color: #9ca3af;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.detail-modal__score strong {
  color: #111827;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 1.05rem;
  line-height: 1;
}

.detail-modal__description {
  margin-top: 1.25rem;
  border-top: 1px solid rgba(229, 231, 235, 0.82);
  padding: 1rem 0.35rem 0 0;
  color: #4b5563;
  font-size: 0.92rem;
  line-height: 1.85;
}

.detail-modal__actions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 0.75rem;
  border-top: 1px solid rgba(229, 231, 235, 0.86);
  padding: 0.85rem 1.1rem 1rem;
  background: rgba(255, 255, 255, 0.96);
}

.detail-modal__primary,
.detail-modal__secondary {
  border: 1px solid #111827;
  min-height: 2.8rem;
  padding: 0.85rem 1.25rem;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  line-height: 1.2;
  text-transform: uppercase;
  cursor: pointer;
  transition: background-color 0.25s ease, color 0.25s ease, transform 0.2s ease;
}

.detail-modal__primary {
  background: #111827;
  color: #fff;
}

.detail-modal__secondary {
  background: transparent;
  color: #111827;
}

.detail-modal__primary:hover,
.detail-modal__secondary:hover {
  transform: translateY(-1px);
}

.detail-modal__primary:hover {
  background: #1f2937;
}

.detail-modal__secondary:hover {
  background: #111827;
  color: #fff;
}

@media (min-width: 768px) {
  .detail-modal {
    padding: 1.5rem;
  }

  .detail-modal__cover-wrap {
    width: min(100%, 30rem);
    max-height: min(90vh, 52rem);
  }
}

@media (max-width: 767px) {
  .detail-modal {
    align-items: stretch;
  }

  .detail-modal__panel {
    height: 100%;
    grid-template-rows: minmax(10rem, 32vh) minmax(0, 1fr);
    gap: 0.75rem;
    overflow: hidden;
  }

  .detail-modal__cover-wrap {
    width: min(65vw, 15rem);
    height: 100%;
    max-height: none;
  }

  .detail-modal__content {
    min-height: 0;
    background: #fff;
  }

  .detail-modal__actions {
    position: sticky;
    bottom: 0;
  }

  .detail-modal__primary,
  .detail-modal__secondary {
    flex: 1 1 100%;
  }

  .detail-modal__profile-summary { grid-template-columns: minmax(0, 1fr) auto; }
  .detail-modal__profile-summary > button { grid-column: 1 / -1; width: 100%; }
  .detail-modal__scores { grid-template-columns: 1fr; }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.35s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
