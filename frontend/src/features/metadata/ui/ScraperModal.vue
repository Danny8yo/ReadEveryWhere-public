<template>
  <UiOverlay :open="isOpen" kind="modal" width="640px" labelledby="scraper-title" @close="$emit('close')">
    <header class="ui-modal-head">
      <div>
        <h2 id="scraper-title">刮削元数据</h2>
        <p v-if="book">{{ book.title }}</p>
      </div>
      <UiButton variant="ghost" icon="close" icon-only label="关闭" @click="$emit('close')" />
    </header>

    <div class="ui-modal-body">
      <!-- 检索条件 -->
      <form v-if="!selectedResult" class="scraper-form" @submit.prevent="searchMetadata">
        <UiField label="元数据来源">
          <UiSegmented v-model="form.provider" :options="providerOptions" label="元数据来源" />
        </UiField>
        <UiField v-if="form.provider !== 'AI'" label="关键词（必填）" for-id="scraper-keyword" hint="默认使用书名；书名不可用时回退 ISBN 或文件名。">
          <div class="scraper-form__row">
            <input id="scraper-keyword" v-model="form.keyword" class="ui-input" placeholder="支持书名或 ISBN" />
            <UiButton type="submit" variant="primary" icon="search" :disabled="isSearching || !form.keyword.trim()">{{ isSearching ? '检索中…' : '检索' }}</UiButton>
          </div>
        </UiField>
        <UiButton v-else type="submit" variant="primary" icon="sparkle" :disabled="isSearching">{{ isSearching ? '分析中…' : '用 AI 读取书籍生成元数据' }}</UiButton>
      </form>

      <p v-if="error" role="alert" class="scraper-error">{{ error }}</p>
      <p v-if="isSearching" class="scraper-hint" role="status">正在查询所选数据源...</p>

      <!-- 候选列表 -->
      <div v-if="!selectedResult && results.length > 0" class="scraper-list">
        <button
          v-for="res in results"
          :key="res.candidate.sourceBookId"
          type="button"
          class="scraper-item"
          @click="previewResult(res)"
        >
          <span class="scraper-item__cover"><BookCover :title="res.candidate.title" :cover-url="res.candidate.coverUrl" /></span>
          <span class="scraper-item__text">
            <strong>{{ res.candidate.title }}</strong>
            <span>{{ res.candidate.authors.join(', ') }}<template v-if="res.candidate.publishYear"> · {{ res.candidate.publishYear }}</template></span>
            <span class="scraper-item__match">
              <UiStatus :tone="matchTone(res.match.level)">{{ matchLevelLabel(res.match.level) }}</UiStatus>
              来源：{{ res.candidate.sourcePlatform }}
            </span>
          </span>
          <UiIcon name="forward" :size="14" />
        </button>
      </div>

      <p v-if="!selectedResult && !isSearching && searchDone && results.length === 0" class="scraper-hint">未找到匹配的元数据，换个关键词或来源再试。</p>

      <!-- 候选预览 -->
      <div v-if="selectedResult" class="scraper-preview">
        <div class="scraper-preview__top">
          <span class="scraper-preview__cover"><BookCover :title="selectedResult.candidate.title" :cover-url="selectedResult.candidate.coverUrl" /></span>
          <div class="scraper-preview__title">
            <h3>{{ selectedResult.candidate.title }}</h3>
            <p>{{ selectedResult.candidate.authors.join(', ') }}</p>
            <UiStatus :tone="matchTone(selectedResult.match.level)">{{ matchLevelLabel(selectedResult.match.level) }}</UiStatus>
          </div>
        </div>
        <dl class="ui-readonly scraper-preview__facts">
          <div v-if="selectedResult.candidate.isbn"><dt>ISBN</dt><dd>{{ selectedResult.candidate.isbn }}</dd></div>
          <div v-if="selectedResult.candidate.publisher"><dt>出版社</dt><dd>{{ selectedResult.candidate.publisher }}</dd></div>
          <div v-if="selectedResult.candidate.publishYear"><dt>出版年份</dt><dd>{{ selectedResult.candidate.publishYear }}</dd></div>
          <div v-if="selectedResult.candidate.language"><dt>语言</dt><dd>{{ selectedResult.candidate.language }}</dd></div>
          <div v-if="selectedResult.candidate.editionTag"><dt>版本</dt><dd>{{ selectedResult.candidate.editionTag }}</dd></div>
          <div><dt>来源</dt><dd>{{ selectedResult.candidate.sourcePlatform }}</dd></div>
        </dl>
        <div v-if="selectedResult.candidate.description" class="scraper-preview__desc">
          <span>简介</span>
          <p>{{ selectedResult.candidate.description }}</p>
        </div>
      </div>
    </div>

    <footer class="ui-modal-foot">
      <template v-if="selectedResult">
        <UiButton icon="back" @click="selectedResult = null">返回列表</UiButton>
        <UiButton variant="primary" icon="check" @click="applyResult(selectedResult.candidate)">应用此元数据</UiButton>
      </template>
      <UiButton v-else @click="$emit('close')">取消</UiButton>
    </footer>
  </UiOverlay>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue';
import type { LibraryBook } from '../../library/model/library';
import { useSingleMetadata } from '../web/useSingleMetadata';
import type { MatchedMetadataCandidate, MetadataMatchLevel, ScrapedResult } from '../model/metadata';
import { buildMetadataScrapeKeyword } from '../domain/keyword';
import BookCover from '../../../shared/ui/BookCover.vue';
import UiButton from '../../../shared/ui/UiButton.vue';
import UiField from '../../../shared/ui/UiField.vue';
import UiIcon from '../../../shared/ui/UiIcon.vue';
import UiOverlay from '../../../shared/ui/UiOverlay.vue';
import UiSegmented from '../../../shared/ui/UiSegmented.vue';
import UiStatus from '../../../shared/ui/UiStatus.vue';

const providerOptions = [
  { value: 'zlibrary' as const, label: 'Z-Library' },
  { value: 'douban' as const, label: '豆瓣' },
  { value: 'AI' as const, label: 'AI（读取内置书籍）' },
];
const matchTone = (level: MetadataMatchLevel) => level === 'edition' ? 'ok' : level === 'conflict' ? 'err' : 'warn';

const props = defineProps<{
  isOpen: boolean;
  book: LibraryBook | null;
}>();

const emit = defineEmits<{
  close: [];
  apply: [data: ScrapedResult];
}>();

const form = reactive<{ keyword: string; provider: 'zlibrary' | 'douban' | 'AI' }>({ keyword: '', provider: 'zlibrary' });
const { isSearching, results, searchDone, error, search } = useSingleMetadata(() => props.book ? props.book.id : null);
const selectedResult = ref<MatchedMetadataCandidate | null>(null);

watch(() => props.book, (b) => {
  if (b) {
    form.keyword = buildMetadataScrapeKeyword(b);
    form.provider = 'zlibrary';
    results.value = [];
    searchDone.value = false;
    selectedResult.value = null;
  }
}, { immediate: true });

const searchMetadata = async () => {
  const q = form.keyword.trim();
  if (form.provider !== 'AI' && !q) return;

  selectedResult.value = null;
  await search(form.provider, q);
};

const previewResult = (res: MatchedMetadataCandidate) => {
  selectedResult.value = res;
};

const matchLevelLabel = (level: MetadataMatchLevel) => ({
  edition: '同一版本',
  work: '同一作品，版本待确认',
  ambiguous: '匹配依据不足',
  conflict: '存在冲突',
})[level];

const applyResult = (res: ScrapedResult) => {
  emit('apply', res);
  emit('close');
};
</script>

<style scoped>
.scraper-form { display: grid; gap: 14px; }
.scraper-form__row { display: flex; gap: 8px; }
.scraper-form__row .ui-input { flex: 1; min-width: 0; }
.scraper-error { margin: 0; padding: 10px 14px; border-radius: 12px; background: color-mix(in srgb, var(--ui-err) 10%, var(--ui-surface)); color: var(--ui-err); font-size: 13px; }
.scraper-hint { margin: 0; font-size: 13px; color: var(--ui-muted); text-align: center; }
.scraper-list { display: grid; gap: 8px; }
.scraper-item {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--ui-line);
  border-radius: var(--ui-radius-card);
  background: var(--ui-surface);
  color: var(--ui-fg);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.scraper-item:hover, .scraper-item:focus-visible { border-color: var(--ui-fg); outline: none; }
.scraper-item__cover :deep(.book-cover) { border-radius: 3px; }
.scraper-item__text { display: grid; gap: 3px; min-width: 0; }
.scraper-item__text strong { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scraper-item__text > span { font-size: 12px; color: var(--ui-muted); }
.scraper-item__match { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.scraper-preview { display: grid; gap: 14px; }
.scraper-preview__top { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 16px; align-items: end; }
.scraper-preview__cover :deep(.book-cover) { box-shadow: 0 14px 28px -14px var(--ui-shadow); }
.scraper-preview__title { display: grid; gap: 6px; justify-items: start; }
.scraper-preview__title h3 { margin: 0; font-size: 20px; font-weight: 900; line-height: 1.25; }
.scraper-preview__title p { margin: 0; font-size: 13px; color: var(--ui-fg2); }
.scraper-preview__facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.scraper-preview__desc span { font-size: 12px; color: var(--ui-muted); }
.scraper-preview__desc p { margin: 4px 0 0; max-height: 9em; overflow-y: auto; font-size: 13px; line-height: 1.7; color: var(--ui-fg2); }
</style>
