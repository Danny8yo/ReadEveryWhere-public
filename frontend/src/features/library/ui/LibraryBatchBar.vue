<template>
  <!-- 批量操作条：放在书架内容之后，吸附在视口底部；列表视图常驻，封面墙进入“选择”后出现 -->
  <div class="library-batchbar" role="toolbar" aria-label="批量操作">
    <strong class="library-batchbar__count">已选 {{ selectedCount }} 本</strong>
    <span class="library-batchbar__group">
      <button
        type="button"
        class="library-batchbar__btn"
        aria-label="批量 AI 预分析"
        :disabled="selectedCount === 0 || isBatchAnalyzing"
        @click="emit('batch-analyze')"
      >
        <UiIcon name="sparkle" :size="14" />
        {{ isBatchAnalyzing ? 'AI 预分析中' : 'AI 预分析' }}
      </button>
      <BookAnalysisHelp class="library-batchbar__help" />
    </span>
    <span class="library-batchbar__sep" aria-hidden="true" />
    <span class="library-batchbar__group">
      <label class="library-batchbar__select">
        <span class="library-batchbar__sr">刮削来源</span>
        <select v-model="batchProvider" aria-label="批量刮削来源">
          <option value="zlibrary">来源：Z-Library</option>
          <option value="douban">来源：豆瓣</option>
          <option value="AI">来源：AI</option>
        </select>
        <UiIcon name="chevronDown" :size="12" />
      </label>
      <button
        type="button"
        class="library-batchbar__btn"
        :disabled="selectedCount === 0 || isBatchScraping"
        @click="emit('batch-scrape', batchProvider)"
      >
        {{ isBatchScraping ? `批量刮削中 ${batchScrapeDone}/${batchScrapeTotal}` : '批量刮削' }}
      </button>
    </span>
    <span class="library-batchbar__sep" aria-hidden="true" />
    <button
      type="button"
      class="library-batchbar__btn library-batchbar__btn--danger"
      :disabled="selectedCount === 0"
      @click="emit('batch-delete')"
    >
      <UiIcon name="trash" :size="14" />
      删除
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import BookAnalysisHelp from '../../metadata/ui/BookAnalysisHelp.vue';
import UiIcon from '../../../shared/ui/UiIcon.vue';

defineProps<{
  selectedCount: number;
  isBatchScraping?: boolean;
  batchScrapeDone?: number;
  batchScrapeTotal?: number;
  isBatchAnalyzing?: boolean;
}>();

const emit = defineEmits<{
  'batch-delete': [];
  'batch-scrape': [provider: 'zlibrary' | 'douban' | 'AI'];
  'batch-analyze': [];
}>();

const batchProvider = ref<'zlibrary' | 'douban' | 'AI'>('zlibrary');
</script>

<style scoped>
.library-batchbar {
  position: sticky;
  bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  z-index: var(--ui-z-sticky);
  width: fit-content;
  max-width: 100%;
  margin: 28px auto 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 8px 8px 8px 16px;
  border-radius: 20px;
  background: var(--ui-strong);
  color: var(--ui-on-strong);
  box-shadow: 0 18px 40px -12px var(--ui-shadow);
}
@media (max-width: 640px) {
  .library-batchbar { bottom: calc(var(--app-tabbar-h) + 10px + env(safe-area-inset-bottom, 0px)); padding-left: 12px; }
  /* 手机上会折成两行，分隔线会悬在行尾，直接去掉 */
  .library-batchbar__sep { display: none; }
}
.library-batchbar__count { margin-right: 6px; font-size: 13px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.library-batchbar__group { display: inline-flex; align-items: center; gap: 6px; }
.library-batchbar__sep { width: 1px; height: 20px; background: color-mix(in srgb, var(--ui-on-strong) 25%, transparent); }
.library-batchbar__btn,
.library-batchbar__select {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 0 12px;
  border: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-on-strong) 12%, transparent);
  color: var(--ui-on-strong);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
}
.library-batchbar__btn:disabled { opacity: 0.45; cursor: not-allowed; }
.library-batchbar__btn:focus-visible, .library-batchbar__select:focus-within { outline: 2px solid var(--ui-on-strong); outline-offset: 2px; }
.library-batchbar__btn--danger { color: var(--ui-err); }
.library-batchbar__select { position: relative; padding-right: 10px; }
.library-batchbar__select select {
  appearance: none;
  border: 0;
  outline: none;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.library-batchbar__select option { color: initial; }
.library-batchbar__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.library-batchbar__help :deep(.book-analysis-help__trigger) { background: transparent; color: color-mix(in srgb, var(--ui-on-strong) 70%, transparent); }
</style>
