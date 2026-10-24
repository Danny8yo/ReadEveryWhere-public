<template>
  <UiOverlay
    :open="isOpen"
    kind="modal"
    width="980px"
    labelledby="batch-metadata-title"
    panel-class="review-modal"
    :close-on-escape="!busy"
    :close-on-scrim="!busy"
    @close="emit('close')"
  >
    <header class="review-modal__head">
      <div class="review-modal__title">
        <p>{{ providerLabel }} · {{ books.length }} 本</p>
        <h2 id="batch-metadata-title">批量元数据审核</h2>
        <p data-testid="batch-metadata-summary" class="review-modal__summary">
          可应用 {{ acceptedCount }} · 待确认 {{ reviewCount }} · 已更新 {{ appliedCount }} · 未变化 {{ unchangedCount }} · 无候选 {{ noCandidateCount }} · 失败 {{ failedCount }}
        </p>
      </div>
      <UiButton variant="ghost" icon="close" icon-only label="关闭批量元数据审核" :disabled="busy" @click="emit('close')" />
    </header>

    <div v-if="collecting" class="review-modal__progress" role="progressbar" aria-label="候选检索进度" :aria-valuenow="progressPercent" aria-valuemin="0" aria-valuemax="100">
      <i :style="{ width: `${progressPercent}%` }" />
    </div>

    <div class="review-modal__main">
      <!-- 不用 <nav>：应用约定页面只有一个 <nav>（e2e 依赖） -->
      <div class="review-list" role="navigation" aria-label="批量刮削书籍">
        <button
          v-for="entry in entries"
          :key="entry.book.id"
          type="button"
          class="review-list__item"
          :class="{ 'review-list__item--on': activeEntry?.book.id === entry.book.id }"
          :aria-current="activeEntry?.book.id === entry.book.id ? 'true' : undefined"
          @click="activeBookId = entry.book.id"
        >
          <span class="review-list__cover"><BookCover :title="entry.book.title" :cover-url="entry.book.coverUrl" /></span>
          <span class="review-list__text">
            <strong>{{ entry.book.title }}</strong>
            <span>{{ entryStatusLabel(entry) }}</span>
          </span>
        </button>
      </div>

      <section v-if="activeEntry" class="review-detail">
        <div class="review-current">
          <span class="review-current__cover"><BookCover :title="activeEntry.book.title" :cover-url="activeEntry.book.coverUrl" /></span>
          <div>
            <p class="review-current__label">当前书籍</p>
            <h3>{{ activeEntry.book.title }}</h3>
            <p>{{ activeEntry.book.authors.join(', ') || '作者未知' }}<template v-if="activeEntry.book.isbn"> · ISBN {{ activeEntry.book.isbn }}</template></p>
          </div>
        </div>

        <UiField v-if="provider !== 'AI'" label="检索关键词" for-id="review-keyword">
          <div class="review-keyword">
            <input id="review-keyword" v-model="activeEntry.keyword" data-testid="retry-keyword" class="ui-input" />
            <UiButton data-testid="retry-candidate-search" icon="refresh" :disabled="busy || !activeEntry.keyword.trim()" @click="retryActive">重新检索</UiButton>
          </div>
        </UiField>

        <p v-if="activeEntry.error" class="review-msg review-msg--err">{{ activeEntry.error }}</p>
        <p v-else-if="activeEntry.status === 'unchanged'" class="review-msg">未更新：{{ activeEntry.resultNote }}</p>
        <p v-else-if="activeEntry.status === 'no_candidates'" class="review-msg">当前关键词没有返回候选。</p>
        <p v-else-if="activeEntry.status === 'searching' || activeEntry.status === 'pending'" class="review-msg">正在检索候选...</p>

        <div v-if="activeEntry.candidates.length > 0" class="review-cands" role="radiogroup" aria-label="候选元数据">
          <button
            v-for="(item, index) in activeEntry.candidates"
            :key="`${item.candidate.sourcePlatform}:${item.candidate.sourceBookId}`"
            type="button"
            role="radio"
            class="review-cand"
            :class="{ 'review-cand--on': activeEntry.selectedIndex === index }"
            :aria-checked="activeEntry.selectedIndex === index"
            @click="selectCandidate(index)"
          >
            <span class="review-cand__radio" aria-hidden="true" />
            <span class="review-cand__cover"><BookCover :title="item.candidate.title" :cover-url="item.candidate.coverUrl" /></span>
            <span class="review-cand__text">
              <span class="review-cand__head">
                <strong>{{ item.candidate.title }}</strong>
                <UiStatus :tone="matchTone(item.match.level)">{{ matchLevelLabel(item.match.level) }}</UiStatus>
              </span>
              <span>{{ item.candidate.authors.join(', ') || '作者未知' }}</span>
              <span>{{ [item.candidate.publisher, item.candidate.publishYear, item.candidate.isbn].filter(Boolean).join(' · ') || '无版本信息' }}</span>
              <span class="review-cand__signals">
                <span v-for="signal in item.match.signals" :key="signal" class="review-cand__signal">{{ signalLabel(signal) }}</span>
                <span v-for="conflict in item.match.conflicts" :key="conflict" class="review-cand__conflict">{{ conflictLabel(conflict) }}</span>
              </span>
            </span>
          </button>
        </div>

        <div v-if="activeEntry.candidates.length > 0 && !isTerminalApplyStatus(activeEntry.status)" class="review-actions">
          <UiButton data-testid="confirm-candidate" variant="primary" icon="check" :disabled="busy || activeEntry.selectedIndex === null" @click="confirmActive">确认所选候选</UiButton>
          <UiButton :disabled="busy" @click="skipActive">跳过此书</UiButton>
        </div>

        <p v-if="activeEntry.status === 'applied'" class="review-msg review-msg--ok">元数据已应用。</p>
        <p v-else-if="activeEntry.status === 'apply_failed'" class="review-msg review-msg--err">应用失败：{{ activeEntry.error }}</p>
      </section>

      <div v-else class="review-empty">没有待处理书籍</div>
    </div>

    <footer class="ui-modal-foot">
      <p class="ui-modal-foot__note">检索阶段不会修改书籍；只有最终应用时才写入已确认项。</p>
      <UiButton data-testid="apply-confirmed" variant="primary" :disabled="busy || acceptedCount === 0" @click="applyConfirmed">
        {{ applying ? `应用中 ${applyDone}/${applyTotal}` : `应用已确认的 ${acceptedCount} 本` }}
      </UiButton>
    </footer>
  </UiOverlay>
</template>

<script setup lang="ts">
import { watch } from 'vue';
import type { LibraryBook } from '../../library/model/library';
import type { MetadataProvider, MetadataMatchLevel, MetadataMatchSignal, MetadataMatchConflict } from '../model/metadata';
import type { EntryStatus, ReviewEntry } from '../domain/batchReview';
import { useBatchMetadataReview } from '../web/useBatchMetadataReview';
import BookCover from '../../../shared/ui/BookCover.vue';
import UiButton from '../../../shared/ui/UiButton.vue';
import UiField from '../../../shared/ui/UiField.vue';
import UiOverlay from '../../../shared/ui/UiOverlay.vue';
import UiStatus from '../../../shared/ui/UiStatus.vue';
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

function matchTone(level: MetadataMatchLevel): 'ok' | 'info' | 'warn' | 'err' {
  return level === 'edition' ? 'ok' : level === 'work' ? 'info' : level === 'conflict' ? 'err' : 'warn';
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

<style scoped>
.review-modal__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 18px 20px 14px; border-bottom: 1px solid var(--ui-line); }
.review-modal__title { display: grid; gap: 2px; min-width: 0; }
.review-modal__title p { margin: 0; font-size: 12px; color: var(--ui-muted); }
.review-modal__title h2 { margin: 0; font-size: 18px; font-weight: 900; }
.review-modal__summary { font-variant-numeric: tabular-nums; }
.review-modal__progress { height: 3px; background: var(--ui-surface2); }
.review-modal__progress i { display: block; height: 100%; background: var(--ui-fg); transition: width 0.3s; }
.review-modal__main { display: grid; grid-template-columns: 250px minmax(0, 1fr); min-height: 360px; }
.review-list { display: grid; gap: 4px; align-content: start; padding: 10px; border-right: 1px solid var(--ui-line); background: var(--ui-bg2); }
.review-list__item { display: grid; grid-template-columns: 30px minmax(0, 1fr); align-items: center; gap: 10px; padding: 8px; border: 0; border-radius: 12px; background: transparent; color: var(--ui-fg); font: inherit; text-align: left; cursor: pointer; }
.review-list__item:hover { background: color-mix(in srgb, var(--ui-fg) 5%, transparent); }
.review-list__item--on { background: var(--ui-surface); box-shadow: 0 1px 0 var(--ui-line); }
.review-list__item:focus-visible { outline: 2px solid var(--ui-fg); outline-offset: -2px; }
.review-list__cover :deep(.book-cover) { border-radius: 3px; }
.review-list__text { display: grid; min-width: 0; }
.review-list__text strong { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.review-list__text span { font-size: 12px; color: var(--ui-muted); }
.review-detail { display: grid; gap: 14px; align-content: start; padding: 18px 20px; min-width: 0; }
.review-current { display: grid; grid-template-columns: 54px minmax(0, 1fr); gap: 12px; align-items: center; }
.review-current__cover :deep(.book-cover) { border-radius: 4px; }
.review-current h3 { margin: 0; font-size: 16px; font-weight: 900; }
.review-current p { margin: 0; font-size: 12px; color: var(--ui-muted); }
.review-current__label { font-size: 11px !important; }
.review-keyword { display: flex; gap: 8px; }
.review-keyword .ui-input { flex: 1; min-width: 0; }
.review-msg { margin: 0; font-size: 13px; color: var(--ui-muted); }
.review-msg--err { color: var(--ui-err); }
.review-msg--ok { color: var(--ui-ok); }
.review-cands { display: grid; gap: 10px; }
.review-cand { display: grid; grid-template-columns: 18px 52px minmax(0, 1fr); align-items: start; gap: 12px; padding: 12px; border: 1px solid var(--ui-line); border-radius: var(--ui-radius-card); background: var(--ui-surface); color: var(--ui-fg); font: inherit; text-align: left; cursor: pointer; }
.review-cand:hover { border-color: color-mix(in srgb, var(--ui-fg) 35%, transparent); }
.review-cand--on { border-color: var(--ui-fg); box-shadow: 0 0 0 1px var(--ui-fg); }
.review-cand:focus-visible { outline: 2px solid var(--ui-fg); outline-offset: 2px; }
.review-cand__radio { width: 18px; height: 18px; margin-top: 3px; border: 2px solid var(--ui-muted); border-radius: 50%; }
.review-cand--on .review-cand__radio { border: 5px solid var(--ui-fg); }
.review-cand__cover :deep(.book-cover) { border-radius: 4px; }
.review-cand__text { display: grid; gap: 3px; min-width: 0; font-size: 12px; color: var(--ui-muted); }
.review-cand__head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 6px; }
.review-cand__head strong { color: var(--ui-fg); font-size: 15px; min-width: 0; }
.review-cand__signals { display: flex; flex-wrap: wrap; gap: 4px 10px; margin-top: 4px; }
.review-cand__signal { color: var(--ui-ok); }
.review-cand__conflict { color: var(--ui-err); }
.review-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.review-empty { display: grid; place-items: center; padding: 40px; color: var(--ui-muted); font-size: 14px; }
@media (max-width: 720px) {
  .review-modal__main { grid-template-columns: 1fr; }
  .review-list { grid-auto-flow: column; grid-auto-columns: 200px; overflow-x: auto; border-right: 0; border-bottom: 1px solid var(--ui-line); }
  .review-detail { padding: 16px; }
}
</style>
