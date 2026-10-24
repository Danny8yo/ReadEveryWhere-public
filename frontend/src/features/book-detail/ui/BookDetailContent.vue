<template>
  <div v-if="book" class="detail" :style="{ '--detail-accent': accent }">
    <div class="detail__art">
      <UiButton class="detail__close" variant="ghost" icon="close" icon-only label="关闭" @click="emit('close')" />
      <div class="detail__top">
        <div class="detail__cover">
          <BookCover :title="book.title" :author="book.authors[0] ?? null" :cover-url="book.coverUrl" />
        </div>
        <div class="detail__info">
          <p class="detail__src">{{ sourceLabel }}<template v-if="formatsText"> · {{ formatsText }}</template></p>
          <h2 id="book-detail-title" class="detail__title">{{ book.title }}</h2>
          <p class="detail__by">{{ primaryAuthor }}</p>
          <p class="detail__meta">
            <span v-if="book.publisher">{{ book.publisher }}</span>
            <span>{{ book.publishYear ?? '未知年份' }}</span>
            <span>ISBN {{ displayIsbn || '未提供' }}</span>
            <span>{{ book.fileSizeText ?? '未知大小' }}</span>
          </p>
          <div class="detail__actions">
            <!-- 采集：加入书架（按钮文字随入库进度变化）、在线阅读、下载到本机 -->
            <UiButton
              v-if="mode === 'search'"
              variant="primary"
              :icon="isCurrentBookAdding ? 'refresh' : 'plus'"
              :class="{ 'detail__busy': isCurrentBookAdding }"
              :disabled="isCurrentBookAdding"
              @click="handleAddToLibrary"
            >{{ addButtonLabel }}</UiButton>
            <!-- 书架：开始阅读 -->
            <UiButton v-if="mode === 'library'" variant="primary" icon="book" :disabled="deleted" @click="handleRead">开始阅读</UiButton>
            <UiButton v-if="mode === 'library'" icon="pen" :disabled="deleted" @click="emit('edit')">编辑信息</UiButton>
            <UiButton v-if="mode === 'library'" icon="refresh" :disabled="deleted" @click="emit('scrape')">刮削元数据</UiButton>
            <UiButton
              v-if="mode === 'search' && book.readOnlineAvailable && book.readOnlineUrl"
              icon="globe"
              @click="openOnlineUrl(book.readOnlineUrl)"
            >在线阅读</UiButton>
            <UiButton
              v-if="mode === 'search' && book.downloadPath && zlibraryBaseUrl"
              icon="download"
              @click="openDownloadUrl"
            >下载到本机</UiButton>
          </div>
        </div>
      </div>
    </div>

    <div class="detail__body">
      <p v-if="deleted" role="alert" class="detail__error">这本书已在其他设备删除</p>
      <p v-if="detailError" role="alert" class="detail__error">{{ detailError }}</p>
      <p v-if="acquisitionError" role="alert" class="detail__error">{{ acquisitionError }}</p>

      <dl v-if="mode === 'search'" class="detail__stats">
        <div><dt>Z-Library 推荐值</dt><dd>{{ zlibraryInterestScoreText }}</dd></div>
        <div><dt>可用格式</dt><dd>{{ formatsText || '未知' }}</dd></div>
        <div><dt>文件大小</dt><dd>{{ book.fileSizeText ?? '未知' }}</dd></div>
      </dl>

      <div class="detail__two">
        <div class="detail__description" v-html="safeDescription"></div>
        <aside class="detail__side">
          <section v-if="mode === 'library'" class="detail__profile">
            <div class="detail__profile-head">
              <span>阅读画像</span>
              <BookAnalysisStatus :status="analysisStatus" />
            </div>
            <strong>{{ profileSummaryLabel }}</strong>
            <small v-if="profileConfidenceLabel !== '未设置'">{{ profileConfidenceLabel }}</small>
            <UiButton size="sm" :disabled="deleted" @click="profileDrawerOpen = true">查看与编辑画像</UiButton>
          </section>
          <!-- 书已删除时整体禁用豆瓣评分区里的按钮 -->
          <fieldset class="detail__lock" :disabled="deleted">
            <DoubanRatingSection
              class="detail__douban"
              :initial-rating="book.doubanRating"
              :default-query="book.title"
              :persist-selection="mode === 'library' ? persistDoubanSelection : undefined"
              @selected="handleDoubanSelected"
            />
          </fieldset>
        </aside>
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
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import sanitizeHtml from 'sanitize-html';
import type { BookDetailModel } from '../model/bookDetail';
import type { DoubanRatingCandidate } from '../../metadata/model/metadata';
import BookAnalysisStatus from '../../metadata/ui/BookAnalysisStatus.vue';
import type { BookAnalysisStatus as BookAnalysisStatusValue } from '../../metadata/model/bookAnalysis';
import type { FormalBookReadingProfile } from '../../metadata/model/bookAnalysis';
import DoubanRatingSection from '../../metadata/ui/DoubanRatingSection.vue';
import BookCover from '../../../shared/ui/BookCover.vue';
import UiButton from '../../../shared/ui/UiButton.vue';
import { bookAccent } from '../../../shared/utils/coverPalette';
import ReadingProfileDrawer from '../../metadata/ui/ReadingProfileDrawer.vue';
import { genreDisplayLabel } from '../../metadata/domain/analysisState';

const props = withDefaults(defineProps<{
  isOpen: boolean;
  book: BookDetailModel | null;
  mode?: 'search' | 'library';
  libraryBookId?: number;
  /** 书架详情：这本书已在其他设备删除，按钮全部不可用 */
  deleted?: boolean;
  acquisition: { busy:boolean; label:string; error:string|null };
  detail: { baseUrl:string|null; error:string|null };
  persistDoubanSelection:(candidate:DoubanRatingCandidate)=>Promise<DoubanRatingCandidate>;
}>(), {
  mode: 'search',
  deleted: false
});

const emit = defineEmits<{
  close: [];
  add: [];
  read: [book: BookDetailModel];
  doubanRatingSelected: [bookId: string, rating: DoubanRatingCandidate];
  analyze: [payload: { bookId: number; force: boolean }];
  profileUpdated: [profile: FormalBookReadingProfile];
  /** 书架详情：打开编辑 / 刮削弹窗（弹窗叠在详情之上） */
  edit: [];
  scrape: [];
}>();

const zlibraryBaseUrl = computed(() => props.detail.baseUrl);
const detailError = computed(() => props.detail.error);
const persistDoubanSelection = (candidate:DoubanRatingCandidate) => props.persistDoubanSelection(candidate);
const profileDrawerOpen = ref(false);
const isCurrentBookAdding = computed(() => props.acquisition.busy);
const addButtonLabel = computed(() => props.acquisition.label);
const acquisitionError = computed(() => props.acquisition.error);
const handleAddToLibrary = () => emit('add');

// 书色：后端还没有封面主色字段（视觉重构计划 B3），先用书名哈希色
const accent = computed(() => bookAccent(props.book?.title ?? ''));
const sourceLabel = computed(() => props.mode === 'library' ? '我的书架' : props.book?.sourcePlatform === 'zlibrary' ? 'Z-Library' : props.book?.sourcePlatform ?? '');
const formatsText = computed(() => (props.book?.formats ?? []).map(format => format.toUpperCase()).join(' / '));
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
.detail { color: var(--ui-fg); }
.detail__art {
  position: relative;
  padding: 28px 28px 24px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--detail-accent) var(--ui-tint), var(--ui-bg)) 0, var(--ui-bg) 100%);
}
.detail__close { position: absolute; top: 14px; right: 14px; background: color-mix(in srgb, var(--ui-bg) 70%, transparent); }
.detail__top { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 28px; align-items: end; }
.detail__cover :deep(.book-cover) { border-radius: 8px; box-shadow: 0 26px 50px -18px var(--ui-shadow); }
.detail__info { min-width: 0; padding-right: 32px; }
.detail__src { margin: 0; font-size: 12px; letter-spacing: 0.08em; color: var(--ui-fg2); }
.detail__title { margin: 6px 0 0; font-size: clamp(28px, 4vw, 44px); font-weight: 900; line-height: 1.08; letter-spacing: -0.02em; text-wrap: balance; overflow-wrap: anywhere; }
.detail__by { margin: 8px 0 0; font-size: 16px; color: var(--ui-fg2); }
.detail__meta { display: flex; flex-wrap: wrap; gap: 2px 14px; margin: 6px 0 0; font-size: 12px; color: var(--ui-muted); }
.detail__actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
/* 入库进行中按钮不可点，但进度文字要看得清，不用通用的半透明禁用样式 */
.detail__busy:disabled { opacity: 0.85; cursor: progress; }
.detail__busy :deep(.ui-icon) { animation: detail-spin 1s linear infinite; }
@keyframes detail-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .detail__busy :deep(.ui-icon) { animation: none; } }

.detail__body { display: grid; gap: 20px; padding: 4px 28px 28px; }
.detail__error { margin: 0; padding: 10px 14px; border-radius: 12px; background: color-mix(in srgb, var(--ui-err) 10%, var(--ui-surface)); color: var(--ui-err); font-size: 13px; }
.detail__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--ui-line);
  border-radius: 14px;
  background: var(--ui-line);
}
.detail__stats div { display: grid; gap: 2px; align-content: start; min-width: 0; padding: 12px 14px; background: var(--ui-surface); }
.detail__stats dt { font-size: 12px; color: var(--ui-muted); }
.detail__stats dd { margin: 0; font-size: 22px; font-weight: 900; line-height: 1.2; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.detail__two { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 22px; align-items: start; }
.detail__description { max-width: 62ch; font-size: 15px; line-height: 1.85; color: var(--ui-fg2); overflow-wrap: anywhere; }
.detail__description :deep(p) { margin: 0 0 0.8em; }
.detail__side { display: grid; gap: 12px; min-width: 0; }
.detail__lock { margin: 0; padding: 0; border: 0; min-width: 0; }
.detail__profile {
  display: grid;
  gap: 6px;
  justify-items: start;
  padding: 14px 16px;
  border: 1px solid var(--ui-line);
  border-radius: var(--ui-radius-card);
  background: var(--ui-surface);
}
.detail__profile-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; width: 100%; font-size: 12px; color: var(--ui-muted); }
.detail__profile strong { font-size: 18px; font-weight: 900; }
.detail__profile small { font-size: 12px; color: var(--ui-muted); margin-bottom: 4px; }

@media (max-width: 640px) {
  .detail__art { padding: 20px 18px; }
  .detail__top { grid-template-columns: 110px minmax(0, 1fr); gap: 16px; }
  .detail__info { padding-right: 0; }
  .detail__close { top: 10px; right: 10px; }
  .detail__actions :deep(.ui-button) { flex: 1 1 auto; }
  .detail__body { padding: 0 18px 22px; }
  .detail__two { grid-template-columns: 1fr; }
  .detail__stats dd { font-size: 18px; }
}
</style>
