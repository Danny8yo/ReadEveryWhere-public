<template>
  <article
    class="library-tile"
    :class="{ 'library-tile--selecting': selecting, 'library-tile--selected': selected }"
    :style="{ '--tile-accent': accent }"
    :data-library-book="book.id"
    @contextmenu.stop.prevent="emit('menu', $event)"
  >
    <div class="library-tile__cover">
      <button
        type="button"
        class="library-tile__hit"
        :aria-label="selecting ? `选择《${book.title}》` : `打开《${book.title}》详情`"
        :aria-pressed="selecting ? selected : undefined"
        @click="activate"
      >
        <BookCover :title="book.title" :author="book.authors[0] ?? null" :cover-url="book.coverUrl">
          <span v-if="attention" class="library-tile__badge" :style="{ '--tone': attention.tone }">{{ attention.label }}</span>
          <span v-if="downloadPending" class="library-tile__download">
            <span>{{ book.downloadStatus === 'queued' ? '等待下载' : '下载中' }}</span>
            <strong>{{ downloadProgress }}%</strong>
            <span class="library-tile__bar"><i :style="{ width: `${downloadProgress}%` }" /></span>
          </span>
          <span v-else-if="book.downloadStatus === 'failed'" class="library-tile__download library-tile__download--failed">下载失败</span>
        </BookCover>
      </button>
      <span v-if="selecting" class="library-tile__check" aria-hidden="true">
        <UiIcon v-if="selected" name="check" :size="14" />
      </span>
    </div>
    <!-- 书名保持为标题元素：e2e（选区问答实测）按 heading 角色找书。键盘入口是上面的封面按钮 -->
    <div class="library-tile__meta" @click="activate">
      <h3 class="library-tile__title">{{ book.title }}</h3>
      <p class="library-tile__sub">
        <span>{{ book.authors.join(', ') || '未知作者' }}</span>
        <span>{{ book.format?.toUpperCase() ?? '无格式' }}</span>
      </p>
    </div>
  </article>
</template>

<script setup lang="ts">
// 书架封面墙里的一本书。普通状态点开详情；选择模式下点击切换选中。
// AI 预分析状态只在需要注意时（排队、分析中、失败、需重新分析）挂角标，已完成和未分析不打扰封面。
import { computed } from 'vue';
import BookCover from '../../../shared/ui/BookCover.vue';
import UiIcon from '../../../shared/ui/UiIcon.vue';
import { bookAccent } from '../../../shared/utils/coverPalette';
import { statusDisplayLabel } from '../../metadata/domain/analysisState';
import type { LibraryBook } from '../model/library';

const props = defineProps<{ book: LibraryBook; selecting: boolean; selected: boolean }>();
const emit = defineEmits<{ open: []; toggle: []; menu: [event: MouseEvent] }>();

const accent = computed(() => bookAccent(props.book.title));
const downloadPending = computed(() => !props.book.isDownloaded && ['queued', 'downloading'].includes(props.book.downloadStatus ?? ''));
const downloadProgress = computed(() => {
  const value = Number(props.book.downloadProgress ?? 0);
  return Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : 0;
});
const ATTENTION_TONE: Record<string, string> = {
  pending: 'var(--ui-info)', running: 'var(--ui-info)', failed: 'var(--ui-err)', stale: 'var(--ui-warn)',
};
const attention = computed(() => {
  const status = props.book.bookAnalysis?.status;
  return status && ATTENTION_TONE[status] ? { label: statusDisplayLabel(status), tone: ATTENTION_TONE[status] } : null;
});

function activate() {
  if (props.selecting) emit('toggle');
  else emit('open');
}
</script>

<style scoped>
.library-tile { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; align-content: start; min-width: 0; }
.library-tile__cover { position: relative; }
.library-tile__hit {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  border-radius: var(--ui-radius-cover);
  background: none;
  cursor: pointer;
}
.library-tile__hit :deep(.book-cover) {
  box-shadow: 0 1px 0 var(--ui-line), 0 6px 16px -10px var(--ui-shadow);
  transition: transform 0.2s ease, box-shadow 0.25s ease, opacity 0.2s;
}
@media (hover: hover) {
  .library-tile__hit:hover :deep(.book-cover) {
    transform: translateY(-4px);
    box-shadow: 0 16px 30px -10px color-mix(in srgb, var(--tile-accent) 80%, transparent);
  }
}
.library-tile__hit:focus-visible { outline: 2px solid var(--ui-fg); outline-offset: 3px; }
.library-tile--selecting:not(.library-tile--selected) .library-tile__hit :deep(.book-cover) { opacity: 0.72; }
.library-tile--selected .library-tile__hit :deep(.book-cover) { outline: 3px solid var(--ui-strong); outline-offset: 3px; }

/* 封面上的叠加物，只在 BookCover 内部比较层级 */
.library-tile__badge {
  --tone: var(--ui-info);
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: var(--ui-z-raised);
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: calc(100% - 12px);
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(10, 10, 12, 0.72);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
  backdrop-filter: blur(6px);
}
.library-tile__badge::before { content: ""; flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--tone); }
.library-tile__download {
  position: absolute;
  inset: 0;
  z-index: var(--ui-z-raised);
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 8px;
  background: rgba(10, 10, 12, 0.62);
  color: #fff;
  font-size: 12px;
  backdrop-filter: blur(2px);
}
.library-tile__download strong { font-size: 24px; font-weight: 900; font-variant-numeric: tabular-nums; }
.library-tile__download--failed { color: #ffb4a8; font-weight: 700; }
.library-tile__bar { display: block; width: 70cqw; height: 3px; border-radius: 2px; background: rgba(255, 255, 255, 0.25); }
.library-tile__bar i { display: block; height: 100%; border-radius: 2px; background: #fff; }

.library-tile__check {
  position: absolute;
  top: 7px;
  left: 7px;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border: 2px solid #fff;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.28);
  color: var(--ui-on-strong);
  pointer-events: none;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
}
.library-tile--selected .library-tile__check { background: var(--ui-strong); border-color: var(--ui-strong); }

/* 单列 minmax(0, 1fr)：长书名、长作者只在列内省略，不能把卡片撑宽 */
.library-tile__meta { display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; min-width: 0; cursor: pointer; }
.library-tile__title { margin: 0; font-size: 13px; font-weight: 700; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.library-tile__sub { margin: 0; display: flex; justify-content: space-between; gap: 6px; font-size: 11px; color: var(--ui-muted); white-space: nowrap; }
/* flex 子项默认不缩到内容宽度以下：作者需 min-width: 0 才会省略，格式标签不缩 */
.library-tile__sub span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.library-tile__sub span:last-child { flex-shrink: 0; }
@media (max-width: 640px) {
  .library-tile__title { font-size: 12px; }
  .library-tile__sub span:last-child { display: none; }
}
</style>
