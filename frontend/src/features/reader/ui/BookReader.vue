<template>
  <div
    class="book-reader fixed inset-0 z-(--ui-z-nav) flex flex-col"
    :class="`theme-${settings.theme}`"
    :style="readerRootStyle"
  >
    <!-- 顶部栏（覆盖在阅读区之上，切换时不改变阅读区尺寸） -->
    <Transition name="slide-down">
      <header ref="headerEl" v-show="uiVisible" class="rd-bar rd-bar--top">
        <button class="rd-ib rd-back" title="返回书架" @click="emit('close')">
          <UiIcon name="back" :size="18" />
          <span class="rd-back__label">书架</span>
        </button>

        <div class="rd-heading">
          <span class="rd-heading__title">{{ bookMetadata.title }}</span>
          <span v-if="currentChapterLabel" class="rd-heading__sub">{{ currentChapterLabel }}</span>
        </div>

        <span
          v-if="syncMessage"
          class="rd-sync"
          :class="{ 'rd-sync--err': syncFailed }"
          role="status"
        >
          {{ syncMessage }}
        </span>

        <div class="rd-bar__group">
          <button
            v-if="!isPdf"
            class="rd-ib"
            :class="{ 'rd-ib--on': searchOpen }"
            title="全文搜索"
            @click="toggleSearchPanel"
          >
            <UiIcon name="search" :size="18" />
          </button>
          <button
            v-if="bookFormat === 'epub'"
            data-testid="selection-qa-open"
            class="rd-ib"
            :class="{ 'rd-ib--on': qa.state.open }"
            title="选区问答与本书记录"
            @click="openQaRecords"
          >
            <UiIcon name="chat" :size="18" />
          </button>
          <button
            class="rd-ib rd-ib--bookmark"
            :class="{ 'rd-ib--on rd-ib--filled': currentBookmarked }"
            :title="currentBookmarked ? '移除书签' : '添加书签'"
            @click="onToggleBookmark"
          >
            <UiIcon name="bookmark" :size="18" />
          </button>
          <button
            class="rd-ib rd-ib--aa"
            :class="{ 'rd-ib--on': settingsOpen }"
            title="阅读设置"
            aria-label="阅读设置"
            :aria-expanded="settingsOpen"
            @click="toggleSettingsPanel"
          >
            Aa
          </button>
        </div>
      </header>
    </Transition>

    <div class="flex flex-1 overflow-hidden relative">
      <!-- 左侧目录（桌面；手机用 MobileReaderToc） -->
      <Transition name="slide-left">
        <aside
          v-show="sidebarOpen"
          class="rd-panel rd-inset-panel absolute left-0 z-(--ui-z-nav) w-72 border-r overflow-y-auto hidden md:block"
        >
          <div class="p-5">
            <h3 class="rd-panel__title mb-3">目录</h3>
            <div ref="tocContainer" class="toc-tree"></div>
            <p v-if="tocNavigationError" role="alert" class="rd-error-text mt-3">
              {{ tocNavigationError }}
            </p>
          </div>
        </aside>
      </Transition>

      <MobileReaderToc :open="sidebarOpen" :items="mobileTocItems" :current-href="currentTocHref" :current-label="currentChapterLabel" :error="tocNavigationError" :busy="tocNavigating"
        @close="sidebarOpen = false" @navigate="navigateFromToc" @search="sidebarOpen = false; toggleSearchPanel()" />

      <!-- 阅读区域 -->
      <div
        ref="readerContainer"
        data-testid="reader-surface"
        class="flex-1 relative overflow-hidden"
        :style="{ background: bgColor }"
      >
        <!-- 加载覆盖层 -->
        <div
          v-if="loading"
          class="rd-state"
          :style="{ background: bgColor }"
        >
          <div class="rd-spinner" />
          <span class="rd-state__text">{{ loadingMessage }}</span>
        </div>

        <!-- 错误覆盖层 -->
        <div
          v-else-if="error"
          class="rd-state"
          :style="{ background: bgColor }"
        >
          <span class="rd-error-text">{{ error }}</span>
          <UiButton size="sm" icon="back" @click="emit('close')">返回书架</UiButton>
        </div>

        <!-- 仅作悬停提示，事件仍由 Adapter 处理，不能遮挡选字或链接。 -->
        <div
          v-if="edgeNavigationEnabled && hoveredEdge"
          class="rd-edge-hint"
          :class="`rd-edge-hint--${hoveredEdge.edge}`"
          :data-edge="hoveredEdge.edge"
          :data-direction="hoveredEdge.side"
          aria-hidden="true"
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.25"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              :d="
                hoveredEdge.edge === 'left' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'
              "
            />
          </svg>
        </div>
        <!-- foliate-view 挂载点 -->
      </div>

      <div
        v-if="!loading && networkBlocked"
        class="rd-blocker"
        role="alert"
      >
        <div class="rd-card">
          <p class="rd-card__title">阅读连接已中断</p>
          <p class="rd-card__text">
            正在重新连接服务器，连接恢复后会自动刷新阅读状态。
          </p>
        </div>
      </div>

      <!-- 阅读设置：桌面是顶栏下方的浮动卡片，手机从底栏上方弹出 -->
      <Transition name="rd-pop">
        <section
          v-if="settingsOpen"
          class="rd-settings"
          aria-label="阅读设置"
        >
          <div v-if="!isPdf" class="rd-settings__row">
            <span class="rd-settings__label">字号 <small>{{ settings.fontSize }}px</small></span>
            <div class="rd-slider">
              <span aria-hidden="true">A</span>
              <input
                type="range"
                min="12"
                max="28"
                step="1"
                v-model.number="settings.fontSize"
                class="rd-range"
                :style="rangeFill(settings.fontSize, 12, 28)"
                aria-label="字号"
              />
              <span aria-hidden="true" class="rd-slider__big">A</span>
            </div>
          </div>

          <div v-if="!isPdf" class="rd-settings__row">
            <span class="rd-settings__label">行距</span>
            <UiSegmented
              :model-value="String(settings.lineSpacing)"
              :options="LINE_SPACING_OPTIONS"
              label="行距"
              @update:model-value="settings.lineSpacing = Number($event)"
            />
          </div>

          <div v-if="!isPdf" class="rd-settings__row">
            <span class="rd-settings__label">字体</span>
            <UiSegmented v-model="settings.fontFamily" :options="FONT_OPTIONS" label="字体" />
          </div>

          <div class="rd-settings__row">
            <span class="rd-settings__label">主题</span>
            <div class="rd-themes" role="radiogroup" aria-label="阅读主题">
              <button
                v-for="t in THEME_OPTIONS"
                :key="t.value"
                type="button"
                role="radio"
                class="rd-themes__item"
                :class="{ 'rd-themes__item--on': settings.theme === t.value }"
                :aria-checked="settings.theme === t.value"
                :style="{ background: getThemeCode(t.value).bg, color: getThemeCode(t.value).fg }"
                @click="settings.theme = t.value"
              >
                {{ t.label }}
              </button>
            </div>
          </div>

          <div v-if="!isPdf" class="rd-settings__row">
            <span class="rd-settings__label">翻页</span>
            <UiSegmented v-model="settings.flow" :options="FLOW_OPTIONS" label="翻页模式" />
          </div>

          <div v-if="!isPdf" class="rd-settings__row">
            <span class="rd-settings__label">页边距 <small>{{ settings.margin }}px</small></span>
            <input
              type="range"
              min="0"
              max="80"
              step="4"
              v-model.number="settings.margin"
              class="rd-range"
              :style="rangeFill(settings.margin, 0, 80)"
              aria-label="页边距"
            />
          </div>

          <div v-if="!isPdf" class="rd-settings__row">
            <span class="rd-settings__label">页面宽度 <small>{{ settings.maxWidth }}px</small></span>
            <input
              type="range"
              min="600"
              max="1600"
              step="50"
              v-model.number="settings.maxWidth"
              class="rd-range"
              :style="rangeFill(settings.maxWidth, 600, 1600)"
              aria-label="页面宽度"
            />
          </div>

          <label v-if="!isPdf" class="rd-check">
            <input type="checkbox" v-model="settings.justify" />
            <span>两端对齐</span>
          </label>
        </section>
      </Transition>

      <SelectionQaSidebar v-if="qa.state.open" v-show="!qaMinimized" :qa="qa" :book-title="bookMetadata.title" :skin-class="skinClass" @minimize="minimizeQa" />
      <button v-if="qa.state.open && qaMinimized" class="qa-minimized" data-testid="selection-qa-restore"
        aria-label="恢复选区问答" @click="restoreQa">
        <UiIcon name="chat" :size="15" />
        问答 · {{ qaMinimizedStatus }} <span aria-hidden="true">↗</span>
      </button>
    </div>

    <!-- 底部栏（覆盖在阅读区之上） -->
    <Transition name="slide-up">
      <footer ref="footerEl" v-show="uiVisible" class="rd-bar rd-bar--bottom">
        <div class="rd-bar__group">
          <button
            class="rd-ib"
            :class="{ 'rd-ib--on': sidebarOpen }"
            title="目录"
            @click="
              if (!qaMinimized) qa.close();
              sidebarOpen = !sidebarOpen;
            "
          >
            <UiIcon name="toc" :size="18" />
          </button>
          <button
            class="rd-ib"
            :class="{ 'rd-ib--on': annotationListOpen }"
            title="批注"
            @click="
              if (!qaMinimized) qa.close();
              annotationListOpen = !annotationListOpen;
            "
          >
            <UiIcon name="pen" :size="18" />
          </button>
          <button
            class="rd-ib"
            :class="{ 'rd-ib--on': bookmarkListOpen }"
            title="书签"
            @click="bookmarkListOpen = !bookmarkListOpen"
          >
            <UiIcon name="bookmark" :size="18" />
          </button>
        </div>

        <!-- PDF 布局与缩放控件 -->
        <div v-if="isPdf" class="rd-pdf-tools">
          <div class="rd-seg" role="group" aria-label="PDF 版式">
            <button
              v-for="mode in pdfLayoutOptions"
              :key="mode.value"
              type="button"
              class="rd-seg__item"
              :class="{ 'rd-seg__item--on': pdfLayout === mode.value }"
              :aria-pressed="pdfLayout === mode.value"
              @click="setPdfLayout(mode.value)"
            >
              {{ mode.label }}
            </button>
          </div>

          <label class="rd-zoom">
            <span class="rd-zoom__value">{{ pdfZoomLabel }}</span>
            <input
              type="range"
              :min="PDF_ZOOM_MIN_PERCENT"
              :max="PDF_ZOOM_MAX_PERCENT"
              :step="PDF_ZOOM_STEP_PERCENT"
              :value="pdfZoomPercent"
              class="rd-range w-28"
              :style="rangeFill(pdfZoomPercent, PDF_ZOOM_MIN_PERCENT, PDF_ZOOM_MAX_PERCENT)"
              title="缩放"
              @input="onPdfZoomInput"
            />
          </label>
          <UiButton variant="ghost" size="sm" @click="pdfZoomReset">适应宽度</UiButton>
        </div>

        <div class="rd-progress">
          <!-- PDF：真实页可精确跳转，显示页码输入；EPUB：无真实页，显示阅读进度%(仿 readest) -->
          <span v-if="isPdf" class="rd-progress__page">
            <input
              type="number"
              min="1"
              :max="totalPages"
              v-model.lazy="currentPage"
              @change="onPageChange"
              aria-label="页码"
              class="rd-page-input [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span>/ {{ totalPages }}</span>
          </span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.001"
            :value="progress"
            @input="onProgressInput"
            class="rd-range rd-range--accent"
            :style="{ '--rd-fill': `${progressPct}%` }"
            aria-label="阅读进度"
          />
          <span v-if="!isPdf" class="rd-progress__pct">{{ progressPct }}%</span>
        </div>

        <div class="rd-bar__group">
          <button class="rd-ib" title="上一页" @click="goPrev">
            <UiIcon name="back" :size="18" />
          </button>
          <button class="rd-ib" title="下一页" @click="goNext">
            <UiIcon name="forward" :size="18" />
          </button>
        </div>
      </footer>
    </Transition>

    <!-- 批注工具栏 -->
    <AnnotationToolbar
      :mode="'epub'"
      :visible="toolbarVisible"
      :position="toolbarPosition"
      :bottom-inset="uiVisible ? footerHeight : 0"
      :existing-annotation="editingAnnotation"
      :note="editingNoteText"
      :annotation-options="annotationOptions"
      :skin-class="skinClass"
      :book-color="accentColor"
      @select-annotation="chooseAnnotation"
      :show-ask-ai="bookFormat === 'epub'"
      :ask-ai-enabled="!!qaAnchor && !!loadedEpubIdentity"
      :ask-ai-reason="qaUnavailableReason || qaAnchorError || '选择正文以提问'"
      @ask-ai="askSelection"
      @apply="onToolbarApply"
      @add-note="onToolbarAddNote"
      @new-note="onToolbarNewNote"
      @remove="onToolbarRemove"
    />

    <!-- 批注输入弹窗 -->
    <AnnotationNoteModal
      :visible="noteModalVisible"
      :selected-text="selectedText"
      :initial-note="editingNoteText"
      :annotation-options="annotationOptions"
      :active-id="editingAnnotation?.id"
      :skin-class="skinClass"
      :notice="annotationConflict && !annotationConflict.current ? '这条笔记已在其他设备删除。你的编辑稿保留在这里，可以复制后另存为新笔记。' : undefined"
      @select-annotation="chooseAnnotation"
      @save="onNoteSave"
      @cancel="onNoteCancel"
    />

    <div
      v-if="annotationConflict?.current"
      class="rd-card rd-conflict"
      role="alert"
    >
      <p class="rd-card__title">该批注已在其他设备修改</p>
      <p class="rd-card__text">
        请选择使用服务器版本，或基于最新版本重新提交当前操作。
      </p>
      <div class="rd-card__actions">
        <UiButton size="sm" @click="onUseServerAnnotationVersion">
          使用服务器版本
        </UiButton>
        <UiButton size="sm" variant="primary" @click="onPrepareAnnotationConflictRetry">
          重新编辑后保存
        </UiButton>
      </div>
    </div>

    <!-- 批注列表面板 -->
    <AnnotationListPanel
      :visible="annotationListOpen"
      :annotations="annotationsForPanel"
      @close="annotationListOpen = false"
      @jump-to="onListPanelJumpTo"
      @view-note="onListPanelViewNote"
      @delete="onListPanelDelete"
    />

    <!-- 书签列表面板 -->
    <BookmarkListPanel
      :visible="bookmarkListOpen"
      :bookmarks="bookmarks"
      @close="bookmarkListOpen = false"
      @jump-to="onBookmarkJumpTo"
      @delete="onBookmarkDelete"
    />

    <!-- 全文搜索面板（EPUB） -->
    <SearchPanel
      :visible="searchOpen"
      :results="searchResults"
      :searching="searching"
      :has-searched="hasSearched"
      :progress="searchProgress"
      @close="closeSearchPanel"
      @search="runSearch"
      @jump-to="onSearchJumpTo"
    />

    <!-- 脚注浮层（EPUB） -->
    <FootnotePopup
      :visible="footnoteVisible"
      :html="footnoteHtml"
      :type="footnoteType"
      :anchor-rect="footnoteRect"
      :skin-class="skinClass"
      @close="closeFootnote"
    />
  </div>
</template>

<script setup lang="ts">
import type { Bookmark } from "../model/bookmark";
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import {
  createReadingSessionState,
  createReadingSession,
} from "../domain/session";
import { reactive, toRef, nextTick } from "vue";
import { createWebReaderHost } from "../web/engineHost";
import SelectionQaSidebar from "../../selection-qa/ui/SelectionQaSidebar.vue";
import { useSelectionQa } from "../../selection-qa/web/useSelectionQa";
import { selectionRequest } from "../../selection-qa/domain/protocol";
import { qaTerminalLabel } from "../../selection-qa/domain/messages";
import type {
  LoadedEpubIdentity,
  EpubSelectionAnchor,
} from "../../selection-qa/model/selectionQa";
import AnnotationToolbar from "./AnnotationToolbar.vue";
import UiIcon from "../../../shared/ui/UiIcon.vue";
import UiButton from "../../../shared/ui/UiButton.vue";
import UiSegmented from "../../../shared/ui/UiSegmented.vue";
import { readingAccent } from "../../../shared/utils/coverPalette";
import MobileReaderToc from "./MobileReaderToc.vue";
import type { TocItem } from "../domain/ReaderPort";
import AnnotationNoteModal from "./AnnotationNoteModal.vue";
import AnnotationListPanel from "./AnnotationListPanel.vue";
import BookmarkListPanel from "./BookmarkListPanel.vue";
import SearchPanel from "./SearchPanel.vue";
import FootnotePopup from "./FootnotePopup.vue";
import type { SearchResultItem } from "../domain/searchResults";
import { useAnnotations } from "../web/useAnnotations";
import { toBookmark } from "../domain/bookmarkCommands";
import { useBookmarks } from "../web/useBookmarks";
import {
  isBookmarked,
  toggleBookmark,
} from "../domain/bookmarks";
import { createReaderSourceLoader } from "../web/sourceLoader";
import type {
  Annotation,
  AnnotationType,
} from "../model/annotation";
import { shouldDownloadPdfWhole } from "../domain/pdfLoadStrategy";
import { resolvePdfLoadingMode } from "../domain/pdfLoadingMode";
import { getBookFormat, getBookFormatMimeType } from "../../../shared/utils/bookFormat";
import { getThemeCode } from "../domain/themes";
import { annotationsForSection } from "../domain/annotationMapping";
import {
  canTurnByEdge,
  resolveReaderTapAction,
  type ReaderInteractionState,
  readerRelocatePosition,
} from "../domain/interaction";
import { resolveReaderEscapeAction } from "../domain/escape";
import type {
  CanonicalLocator,
  DrawnAnnotation,
  FootnoteEvent,
  FootnoteKind,
  ReaderLayoutSettings,
  ReaderPort,
  ReaderRelocateEvent,
  ReaderSelectionEvent,
  ReaderTapEvent,
  ReaderEdgeHoverEvent,
  ViewportRect,
} from "../domain/ReaderPort";
import type { ReaderSource } from "../web/WebReaderPort";

import { useReaderSettings } from "../web/useReaderSettings";
import { useReaderUI } from "../web/useReaderUI";
import { showToast } from "../../../shared/web/toast";
import { useBookDeletion } from "../../library/web/librarySession";
import { useReaderProgress } from "../web/useReaderProgress";
import { useReadingStateSync } from "../web/useReadingStateSync";
import type { ReadingStateSnapshot } from "../model/readingState";
import {
  usePdfViewSettings,
  clampPdfZoomPercent,
  PDF_ZOOM_MIN_PERCENT,
  PDF_ZOOM_MAX_PERCENT,
  PDF_ZOOM_STEP_PERCENT,
  type PdfLayout,
  type PdfZoom,
} from "../web/usePdfViewSettings";

interface BookMetadata {
  title: string;
  authors: string[];
  coverUrl: string | null;
}

const props = defineProps<{
  fileUrl: string;
  fileName: string;
  bookId: number;
  userId: number;
  bookMetadata: BookMetadata;
  mimeType: string | null;
  checksum?: string | null;
  fileSize?: number | null;
  updatedAt: string;
  version: number;
}>();

const pdfLoadingMode = resolvePdfLoadingMode(
  import.meta.env.VITE_PDF_LOADING_MODE,
);
const bookFormat = computed(() =>
  getBookFormat({ mimeType: props.mimeType, fileName: props.fileName }),
);
const isPdf = computed(() => bookFormat.value === "pdf");

const emit = defineEmits<{ close: [] }>();
const bookDeleted = useBookDeletion(() => props.bookId);
watch(bookDeleted, (deleted) => {
  if (!deleted) return;
  showToast("这本书已在其他设备删除", "err");
  emit("close");
});

// ---- State ----
const loading = ref(true);
const error = ref<string | null>(null);
const loadingMessage = ref("正在加载书籍...");
const { loadReaderSource, detach: detachSourceLoad } = createReaderSourceLoader(props, (message) => {
  loadingMessage.value = message;
});
const { uiVisible, sidebarOpen, settingsOpen, annotationListOpen, toggleUI } =
  useReaderUI();
const qaMinimized = ref(false);
const loadedEpubIdentity = ref<LoadedEpubIdentity | null>(null);
const qaUnavailableReason = ref("");
const qaAnchor = ref<EpubSelectionAnchor | null>(null);
const qaAnchorError = ref("");
const qa = useSelectionQa(props.bookId, props.userId, {
  identity: () => loadedEpubIdentity.value,
  navigate: async (cfi) => {
    if (!reader) throw new Error("阅读器尚未准备好");
    await reader.goToLocator({ readerAnchors: { epubcfi: cfi } }, { emphasize: true });
  },
  changed: async () => {
    await readingStateSync.refresh();
  },
});
watch(
  () => qa.state.open,
  (open, previous) => {
    if (!open) qaMinimized.value = false;
    if (previous && !open) {
      uiVisible.value = true;
      void nextTick(() =>
        document
          .querySelector<HTMLElement>('[data-testid="selection-qa-open"]')
          ?.focus(),
      );
    }
  },
);
function prepareQaPanel() {
  qaMinimized.value = false;
  settingsOpen.value = false;
  sidebarOpen.value = false;
  searchOpen.value = false;
  annotationListOpen.value = false;
  bookmarkListOpen.value = false;
  toolbarVisible.value = false;
  noteModalVisible.value = false;
  closeFootnote();
}
function openQaRecords() {
  if (qa.state.open && qaMinimized.value) { restoreQa(); return; }
  if (qa.state.open) { qa.close(); return; }
  prepareQaPanel();
  void qa.open();
  if (qaUnavailableReason.value) qa.state.error = qaUnavailableReason.value;
}
function askSelection() {
  if (!qaAnchor.value) return;
  try {
    const request = selectionRequest(
      props.bookId,
      loadedEpubIdentity.value,
      qaAnchor.value,
    );
    prepareQaPanel();
    void qa.open(request);
  } catch (error) {
    qa.state.error = error instanceof Error ? error.message : String(error);
    qa.state.open = true;
  }
}
const qaMinimizedStatus = computed(() => {
  const turn = qa.state.turns.at(-1);
  if (qa.state.error) return '需要处理';
  if (!turn) return '待提问';
  if (turn.status === 'queued' || turn.status === 'running') return '回答中';
  return qaTerminalLabel(turn);
});
function minimizeQa() {
  uiVisible.value = true;
  qaMinimized.value = true;
  void nextTick(() => document.querySelector<HTMLElement>('[data-testid="selection-qa-restore"]')?.focus());
}
function restoreQa() {
  prepareQaPanel();
  void nextTick(() => document.querySelector<HTMLElement>('[data-testid="selection-qa-minimize"]')?.focus());
}

function toggleSettingsPanel() {
  if (!qaMinimized.value) qa.close();
  settingsOpen.value = !settingsOpen.value;
}

// 顶/底栏浮在阅读区之上，所以阅读区永远是满高的——切换沉浸式不会 resize 它，
// 也就不会触发 foliate 的 ResizeObserver 重新分页。侧边面板不该被浮栏压住
// （底栏左侧就是开关目录的按钮），所以把栏高透出成 CSS 变量供它们内缩。
const headerEl = ref<HTMLElement | null>(null);
const footerEl = ref<HTMLElement | null>(null);
const headerHeight = ref(0);
const footerHeight = ref(0);
let barObserver: ResizeObserver | null = null;

const barInsetStyle = computed(() => ({
  "--rd-bar-top": uiVisible.value ? `${headerHeight.value}px` : "0px",
  "--rd-bar-bottom": uiVisible.value ? `${footerHeight.value}px` : "0px",
}));

// 书色只用于进度条和批注波浪线（封面主色接入前用书名哈希色，见视觉重构计划 B3）
const accentColor = computed(() => readingAccent(props.bookMetadata.title));
const readerRootStyle = computed(() => ({ ...barInsetStyle.value, "--rd-ac": accentColor.value }));
// Teleport 到 body 的浮层不在 .book-reader 里，挂这个类拿到跟随阅读主题的 --ui-* 配色
const skinClass = computed(() => `rd-skin-${settings.theme}`);

const LINE_SPACING_OPTIONS = [
  { value: "1.2", label: "紧凑" },
  { value: "1.5", label: "标准" },
  { value: "1.8", label: "宽松" },
  { value: "2", label: "很宽" },
];
const FONT_OPTIONS = [
  { value: "serif" as const, label: "衬线体" },
  { value: "sans-serif" as const, label: "无衬线体" },
  { value: "system-ui" as const, label: "系统" },
];
const FLOW_OPTIONS = [
  { value: "paginated" as const, label: "分页" },
  { value: "scrolled" as const, label: "滚动" },
];
const THEME_OPTIONS = [
  { value: "light" as const, label: "明亮" },
  { value: "dark" as const, label: "暗黑" },
  { value: "sepia" as const, label: "羊皮" },
];
/** 原生滑块左侧的已选部分用渐变画出来 */
function rangeFill(value: number, min: number, max: number) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return { "--rd-fill": `${Math.min(100, Math.max(0, pct))}%` };
}
const progress = ref(0);
const progressPct = computed(() =>
  Math.round(Math.min(1, Math.max(0, progress.value)) * 100),
);
const currentPage = ref(1);
const totalPages = ref(1);

// ---- Bookmark State ----
const bookmarkListOpen = ref(false);
const {
  bookmarks,
  syncStatus: bookmarkSyncStatus,
  toggle: toggleRemoteBookmark,
  remove: onBookmarkDelete,
} = useBookmarks();
const currentCfi = ref("");
const currentFraction = ref(0);
const currentChapterLabel = ref("");
const currentBookmarked = computed(() =>
  isBookmarked(bookmarks.value, currentCfi.value),
);

// sectionIndex → 章节标题。用于给"入库时没记下章节"的老批注/老书签补上显示用的标签
// （早期 selectedChapterLabel 恒为空串，所有批注都存成了 null）。
const chapterLabelBySection = ref(new Map<number, string>());

/** 该 section 的章节标题；PDF 无目录时退化成页码。 */
function chapterLabelOf(sectionIndex: number | null | undefined): string {
  if (sectionIndex == null) return "";
  const cached = chapterLabelBySection.value.get(sectionIndex);
  if (cached != null) return cached;
  const label =
    reader?.getChapterLabel(sectionIndex) ||
    (isPdf.value ? `第 ${sectionIndex + 1} 页` : "");
  chapterLabelBySection.value.set(sectionIndex, label);
  return label;
}

/** 补齐缺失的章节标签后再交给面板；不回写 annotations，保持"库里存的"与"显示的"分开。 */
const annotationsForPanel = computed(() =>
  annotations.value.map((a) =>
    a.chapterLabel
      ? a
      : {
          ...a,
          chapterLabel:
            chapterLabelBySection.value.get(a.sectionIndex ?? -1) ?? "",
        },
  ),
);

// ---- Search State（全文搜索，EPUB）----
const searchOpen = ref(false);
const searchResults = ref<SearchResultItem[]>([]);
const searching = ref(false);
const hasSearched = ref(false);
const searchProgress = ref(0);
// 递增 token：新搜索发起时旧迭代自检失效即中止，避免旧结果覆盖新结果
let searchToken = 0;

// ---- Footnote Popup State（脚注浮层，EPUB）----
const footnoteVisible = ref(false);
const footnoteHtml = ref("");
const footnoteType = ref<FootnoteKind | null>(null);
const footnoteRect = ref<ViewportRect | null>(null);

// ---- Annotation State ----
const {
  annotations,
  replaceAnnotations,
  createAnnotation: saveAnnotation,
  updateAnnotation: updateAnnotationApi,
  deleteAnnotation: deleteAnnotationApi,
  getAnnotationAt,
  syncStatus: annotationSyncStatus,
  conflict: annotationConflict,
  useServerVersion: useServerAnnotationVersion,
  prepareConflictRetry: prepareAnnotationConflictRetry,
} = useAnnotations(props.bookId);

const toolbarVisible = ref(false);
const toolbarPosition = ref({ x: 0, y: 0 });
const noteModalVisible = ref(false);
const selectedText = ref("");
const selectedCFI = ref("");
const selectedChapterLabel = ref("");
// 阅读器无关选择器（可移植性）：前后缀上下文 + 章节 index
const selectedContextBefore = ref<string | null>(null);
const selectedContextAfter = ref<string | null>(null);
const selectedSectionIndex = ref<number | null>(null);
const editingAnnotation = ref<{
  id: string;
  annotationType: AnnotationType;
  color: string;
  location: string;
} | null>(null);
const editingNoteText = ref<string | null>(null);
const annotationAnchors = ref<Array<{ anchorCfi: string; epubSelection?: EpubSelectionAnchor; selectionError?: string }>>([]);
const annotationOptions = computed(() => annotations.value
  .filter(a => annotationAnchors.value.some(hit => hit.anchorCfi === a.location))
  .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  .map((a, i) => ({ id: a.id, label: `${i + 1}. ${(a.note || '仅标记，无笔记').replace(/\s+/g, ' ').slice(0, 70)}` })));
function chooseAnnotation(id: string) {
  const a = annotations.value.find(item => item.id === id);
  if (!a) throw new Error("批注已不存在，请刷新批注列表");
  editingAnnotation.value = { id: a.id, annotationType: a.annotationType, color: a.color, location: a.location };
  editingNoteText.value = a.note;
  selectedText.value = a.textContent;
  const anchor = annotationAnchors.value.find(hit => hit.anchorCfi === a.location);
  qaAnchor.value = anchor?.epubSelection ?? null;
  qaAnchorError.value = anchor?.selectionError ?? "请重新选中文字以询问 AI";
}
const pendingAnnotationType = ref<AnnotationType>("highlight");
const pendingColor = ref("#ffeb3b");

// ---- Refs ----
const readerContainer = ref<HTMLDivElement>();
const tocContainer = ref<HTMLDivElement>();
const mobileTocItems = ref<TocItem[]>([]);
const currentTocHref = ref("");
const tocNavigating = ref(false);

// 会话通过平台无关 ReaderPort 操作；DOM 和 PDF renderer 由 Web 宿主管理。
let reader: ReaderPort | null = null;
const engineHost = createWebReaderHost();
let tocView: {
  element: HTMLElement;
  setCurrentHref: (href: string) => void;
} | null = null;

// 把后端标注映射成 ReaderPort 的 DrawnAnnotation（含阅读器无关选择器，供重锚定）
function toDrawnAnnotation(a: Annotation): DrawnAnnotation {
  return {
    id: a.id,
    style: a.annotationType,
    color: a.color,
    note: a.note,
    locator: {
      readerAnchors: a.location ? { epubcfi: a.location } : undefined,
      textQuote: a.textContent
        ? {
            exact: a.textContent,
            prefix: a.contextBefore ?? undefined,
            suffix: a.contextAfter ?? undefined,
          }
        : undefined,
      textPosition:
        a.sectionIndex != null
          ? { sectionIndex: a.sectionIndex, start: -1, end: -1 }
          : undefined,
    },
  };
}

function drawAllAnnotations() {
  if (!reader) return;
  for (const a of annotations.value) {
    if (a.locationType === "pdf_page") continue; // 老 PDF 标注已弃：无有效 CFI，跳过
    reader.drawAnnotation(toDrawnAnnotation(a));
  }
}

// ---- Settings ----
const { settings } = useReaderSettings();
const readerProgress = useReaderProgress(props.bookId);
const readingStateSync = useReadingStateSync(props.bookId);
const sessionState = reactive(createReadingSessionState());
const readingSession = createReadingSession(
  sessionState,
  () => {
    if (!reader) throw new Error("READER_NOT_READY");
    return reader;
  },
  readingStateSync,
);
const tocNavigationError = toRef(sessionState, "navigationError");
const remoteProgressChanged = ref(false);
let readerInitialized = false;
const networkBlocked = computed(
  () => readingStateSync.connectionStatus.value === "reconnecting",
);

const syncFailed = computed(
  () =>
    readingStateSync.syncStatus.value === "failed" ||
    readerProgress.syncStatus.value === "failed" ||
    annotationSyncStatus.value === "failed" ||
    bookmarkSyncStatus.value === "failed",
);
const syncMessage = computed(() => {
  if (annotationConflict.value?.current) return "批注存在冲突";
  if (annotationConflict.value) return "批注未保存";
  if (syncFailed.value) return "同步失败";
  if (remoteProgressChanged.value) return "其他设备已更新阅读位置";
  if (
    readingStateSync.syncStatus.value === "syncing" ||
    readerProgress.syncStatus.value === "syncing" ||
    annotationSyncStatus.value === "syncing" ||
    bookmarkSyncStatus.value === "syncing"
  )
    return "同步中";
  if (readingStateSync.connectionStatus.value === "reconnecting")
    return "正在重新连接";
  if (
    readingStateSync.syncStatus.value === "synced" ||
    readerProgress.syncStatus.value === "synced" ||
    annotationSyncStatus.value === "synced" ||
    bookmarkSyncStatus.value === "synced"
  )
    return "已同步";
  return "";
});

function redrawAnnotation(annotation: Annotation) {
  reader?.eraseAnnotation({ readerAnchors: { epubcfi: annotation.location } });
  reader?.drawAnnotation(toDrawnAnnotation(annotation));
}

function onUseServerAnnotationVersion() {
  const current = annotationConflict.value?.current;
  useServerAnnotationVersion();
  if (current) redrawAnnotation(current);
}

function onPrepareAnnotationConflictRetry() {
  const pending = prepareAnnotationConflictRetry();
  if (!pending) return;
  const { current, attempted } = pending;
  redrawAnnotation(current);
  editingAnnotation.value = {
    id: current.id,
    annotationType:
      attempted.kind === "update"
        ? (attempted.edits.annotationType ?? current.annotationType)
        : current.annotationType,
    color:
      attempted.kind === "update"
        ? (attempted.edits.color ?? current.color)
        : current.color,
    location: current.location,
  };
  selectedText.value = current.textContent;
  selectedCFI.value = "";
  editingNoteText.value =
    attempted.kind === "update" && attempted.edits.note !== undefined
      ? attempted.edits.note
      : current.note;
  if (attempted.kind === "update" && attempted.edits.note !== undefined) {
    toolbarVisible.value = false;
    noteModalVisible.value = true;
  } else {
    noteModalVisible.value = false;
    toolbarVisible.value = true;
  }
}

function applyReadingStateSnapshot(
  snapshot: ReadingStateSnapshot,
  isInitial: boolean,
) {
  if (!isInitial) {
    for (const annotation of annotations.value) {
      if (annotation.locationType === "epubcfi") {
        reader?.eraseAnnotation({
          readerAnchors: { epubcfi: annotation.location },
        });
      }
    }
  }
  replaceAnnotations(snapshot.annotations);
  bookmarks.value = snapshot.bookmarks.map(toBookmark);
  if (!isInitial) drawAllAnnotations();
}

watch(
  () => readingStateSync.snapshot.value,
  (snapshot) => {
    if (!snapshot || !readerInitialized) return;
    applyReadingStateSnapshot(snapshot, false);
    if (readingStateSync.lastChange.value?.changed.includes("progress")) {
      remoteProgressChanged.value = true;
    }
  },
);

// ---- PDF layout & zoom（按书持久化，见 usePdfViewSettings） ----
const pdfLayoutOptions: Array<{ value: PdfLayout; label: string }> = [
  { value: "single", label: "单页" },
  { value: "double", label: "双页" },
];
const { pdfView } = usePdfViewSettings(props.bookId);
const pdfLayout = computed(() => pdfView.layout);
const pdfZoom = computed(() => pdfView.zoom);
const pdfZoomPercent = computed(() => pdfView.zoomPercent);
let pdfZoomApplyTimer: number | null = null;

const pdfZoomLabel = computed(() =>
  pdfView.zoom === "fit-width" ? "适应宽度" : `${pdfView.zoomPercent}%`,
);

function getPdfSpreadMode() {
  return pdfView.layout === "single" ? "none" : "both";
}

function applyPdfZoom(value: PdfZoom) {
  if (isPdf.value && reader) {
    engineHost.setPdfZoom(value);
  }
}

function schedulePdfZoomApply(value: PdfZoom) {
  if (pdfZoomApplyTimer !== null) {
    window.clearTimeout(pdfZoomApplyTimer);
  }
  pdfZoomApplyTimer = window.setTimeout(() => {
    pdfZoomApplyTimer = null;
    applyPdfZoom(value);
  }, 90);
}

function onPdfZoomInput(e: Event) {
  const percent = clampPdfZoomPercent(
    Number((e.target as HTMLInputElement).value),
  );
  pdfView.zoomPercent = percent;
  pdfView.zoom = percent / 100;
}

function pdfZoomReset() {
  if (pdfZoomApplyTimer !== null) {
    window.clearTimeout(pdfZoomApplyTimer);
    pdfZoomApplyTimer = null;
  }
  pdfView.zoomPercent = 100;
  pdfView.zoom = "fit-width";
}

function setPdfLayout(mode: PdfLayout) {
  pdfView.layout = mode;
}

async function applyPdfLayout() {
  if (!isPdf.value || !reader) return;
  const targetPageIndex = Math.max(0, currentPage.value - 1);
  toolbarVisible.value = false;
  noteModalVisible.value = false;
  await engineHost.setPdfSpread(getPdfSpreadMode(), targetPageIndex);
}

const bgColor = computed(() => getThemeCode(settings.theme).bg);

// ---- Lifecycle ----
onMounted(() => {
  // v-show 隐藏时元素高度为 0，别把 0 当成真实栏高记下来——隐藏时的内缩由
  // barInsetStyle 直接给 0px。
  barObserver = new ResizeObserver(() => {
    const h = headerEl.value?.offsetHeight ?? 0;
    const f = footerEl.value?.offsetHeight ?? 0;
    if (h > 0) headerHeight.value = h;
    if (f > 0) footerHeight.value = f;
  });
  if (headerEl.value) barObserver.observe(headerEl.value);
  if (footerEl.value) barObserver.observe(footerEl.value);
});

onMounted(async () => {
  try {
    loadingMessage.value =
      isPdf.value && !shouldDownloadPdfWhole(props.fileSize, pdfLoadingMode)
        ? "正在准备 PDF 按需加载..."
        : `正在准备 ${bookFormat.value.toUpperCase()}...`;
    const source = await loadReaderSource();
    loadedEpubIdentity.value =
      source.kind === "file" ? (source.epubIdentity ?? null) : null;
    qaUnavailableReason.value =
      source.kind === "file" ? (source.qaUnavailableReason ?? "") : "";

    if (!readerContainer.value) throw new Error("阅读器容器未挂载");
    reader = await engineHost.open(
      bookFormat.value,
      source,
      readerContainer.value,
      getPdfSpreadMode(),
    );

    reader.on("relocate", onRelocate);
    reader.on("overlay-ready", onReaderLoad);
    reader.on("selection", onSelection);
    reader.on("selection-cleared", onSelectionCleared);
    reader.on("tap-annotation", onTapAnnotation); // 点到高亮 → 编辑（优先）
    reader.on("tap", onTap); // 统一内容区交互策略
    reader.on("edge-hover", (edge) => {
      hoveredEdge.value = edge;
    });
    reader.on("key-navigation", ({ side }) => {
      if (interactionState.value.blocked || noteModalVisible.value) return;
      if (side === "prev") goPrev();
      else goNext();
    });
    reader.on("footnote", onFootnote); // 点脚注引用 → 就地浮层（EPUB）

    if (!isPdf.value) {
      reader.applyLayout(toLayoutSettings());
    } else {
      applyPdfZoom(pdfZoom.value);
      totalPages.value = engineHost.pageCount();
    }

    window.addEventListener("keydown", onKeydown);
    buildTOC();
    readerProgress.start();

    // 在线阅读状态以服务端统一快照为唯一事实源。快照失败时不能用本地旧状态假装开书成功。
    await readingSession.initialize(
      (snapshot) => applyReadingStateSnapshot(snapshot, true),
      (snapshot) => initView(snapshot.progress),
    );

    // 开书兜底：此时首屏 overlayer 才存在（initView 之前 renderer 尚无 iframe，
    // drawAnnotation 会静默 no-op）。overlayer 按 CFI 去重，与 onReaderLoad 的
    // 逐页补画重复调用无副作用。
    drawAllAnnotations();

    // 给没记章节的老批注补上显示用的标签（引擎已就绪才能解析 section → TOC 条目）
    for (const a of annotations.value) {
      if (!a.chapterLabel) chapterLabelOf(a.sectionIndex);
    }

    readerInitialized = true;
    loading.value = false;
  } catch (e: any) {
    error.value = e.message || "加载书籍时发生未知错误";
    loading.value = false;
  }
});

onUnmounted(() => {
  detachSourceLoad();
  window.removeEventListener("keydown", onKeydown);
  barObserver?.disconnect();
  barObserver = null;
  if (pdfZoomApplyTimer !== null) {
    window.clearTimeout(pdfZoomApplyTimer);
    pdfZoomApplyTimer = null;
  }
  // 卸载前 flush 未提交的进度到服务端，避免关书丢最后位置。
  readerProgress.dispose();
  readingSession.close();
  engineHost.dispose();
  reader = null;
});

// ---- 覆盖层挂载后恢复该章标注，文档预加载本身不触发绘制
function onReaderLoad(_e: { sectionIndex: number }) {
  if (!reader) return;
  // 每章 overlay-ready 只画属于该章节的标注（含旧数据 sectionIndex==null 的兜底），
  // 避免"每章重绘全部标注"造成的重复与竞态。
  for (const a of annotationsForSection(annotations.value, _e.sectionIndex)) {
    if (a.locationType === "pdf_page") continue; // 老 PDF 标注已弃：跳过
    reader.drawAnnotation(toDrawnAnnotation(a));
  }
}

// 关闭标注工具栏（多路触发：点击内容区、翻页、Esc）
function dismissToolbar() {
  toolbarVisible.value = false;
  editingAnnotation.value = null;
}

const hoveredEdge = ref<ReaderEdgeHoverEvent | null>(null);
const interactionState = computed<ReaderInteractionState>(() => ({
  blocked: loading.value || !!error.value || networkBlocked.value,
  panelOpen:
    sidebarOpen.value ||
    settingsOpen.value ||
    searchOpen.value ||
    (qa.state.open && !qaMinimized.value) ||
    bookmarkListOpen.value ||
    annotationListOpen.value,
  toolbarVisible: toolbarVisible.value,
  noteModalVisible: noteModalVisible.value,
  footnoteVisible: footnoteVisible.value,
  paginated: isPdf.value || settings.flow === "paginated",
}));
const edgeNavigationEnabled = computed(() =>
  canTurnByEdge(interactionState.value),
);

function onTap(e: ReaderTapEvent) {
  switch (resolveReaderTapAction(e.side, interactionState.value)) {
    case "dismiss-popups":
      dismissToolbar();
      closeFootnote();
      break;
    case "toggle-ui":
      toggleUI();
      break;
    case "prev":
      goPrev();
      break;
    case "next":
      goNext();
      break;
    case "none":
      break;
  }
}

// 点脚注/尾注引用 → 就地弹出浮层（内容 adapter 已抽取，浮层内 sanitize 后渲染）
function onFootnote(e: FootnoteEvent) {
  footnoteHtml.value = e.html;
  footnoteType.value = e.type;
  footnoteRect.value = e.rect;
  footnoteVisible.value = true;
}

function closeFootnote() {
  footnoteVisible.value = false;
}

// 点到已有高亮 → 呼出编辑工具栏（改色/加笔记/删除），优先于翻页/显隐
function onTapAnnotation(e: { anchorCfi: string; rect: ViewportRect; epubSelection?: EpubSelectionAnchor; selectionError?: string; overlapping?: Array<{ anchorCfi: string; epubSelection?: EpubSelectionAnchor; selectionError?: string }> }) {
  annotationAnchors.value = e.overlapping ?? [e];
  const existing = getAnnotationAt(e.anchorCfi);
  if (!existing) return;
  editingAnnotation.value = {
    id: existing.id,
    annotationType: existing.annotationType,
    color: existing.color,
    location: existing.location,
  };
  qaAnchor.value = e.epubSelection ?? null;
  qaAnchorError.value = e.selectionError ?? "";
  selectedText.value = existing.textContent;
  selectedCFI.value = ""; // 非新建选区
  editingNoteText.value = existing.note ?? null;
  toolbarPosition.value = {
    x: Math.max(10, e.rect.x - 140),
    y: Math.max(10, e.rect.y - 70),
  };
  noteModalVisible.value = false;
  toolbarVisible.value = true;
}

// ---- Selection handling（经 ReaderPort 的 selection 事件）----
function onSelectionCleared() {
  // 工具栏接管焦点时正文可能失去原生选区，保留已捕获的定位供本次操作使用。
  if (noteModalVisible.value || document.activeElement?.closest('[data-reader-selection-actions]')) return;
  dismissToolbar();
}

function onSelection(e: ReaderSelectionEvent) {
  if (noteModalVisible.value) return;
  annotationAnchors.value = e.existingAnchorCfi ? [{ anchorCfi: e.existingAnchorCfi, epubSelection: e.epubSelection }] : [];
  qaAnchorError.value = "";
  qaAnchor.value =
    bookFormat.value === "epub" ? (e.epubSelection ?? null) : null;
  selectedText.value = e.text;
  selectedCFI.value = e.locator.readerAnchors?.epubcfi ?? "";
  // 阅读器无关选择器（供换引擎/换版本重锚定）
  selectedContextBefore.value = e.locator.textQuote?.prefix ?? null;
  selectedContextAfter.value = e.locator.textQuote?.suffix ?? null;
  selectedSectionIndex.value = e.locator.textPosition?.sectionIndex ?? null;
  // 曾经恒为 ''，于是每条批注都以 chapterLabel=null 入库，列表里全是"未知章节"
  selectedChapterLabel.value =
    chapterLabelOf(selectedSectionIndex.value) || currentChapterLabel.value;
  editingNoteText.value = null;

  // 选区命中已存在标注 → 进入编辑
  editingAnnotation.value = null;
  if (e.existingAnchorCfi) {
    const existing = getAnnotationAt(e.existingAnchorCfi);
    if (existing) {
      editingAnnotation.value = {
        id: existing.id,
        annotationType: existing.annotationType,
        color: existing.color,
        location: existing.location,
      };
      // 走选区进来的也要带出笔记，否则工具栏上的笔记块只在“点击批注”那条路上出现
      editingNoteText.value = existing.note ?? null;
    }
  }

  toolbarPosition.value = {
    x: Math.max(10, e.rect.x + e.rect.width / 2 - 140),
    y: Math.max(10, e.rect.y - 70),
  };
  toolbarVisible.value = true;
}

// ---- Annotation action handlers ----
function onToolbarApply(type: AnnotationType, color: string) {
  pendingAnnotationType.value = type;
  pendingColor.value = color;

  // 编辑已有标注（选中/点击已有标注后施加）：覆盖类型+颜色（仿 readest），而非新建重复
  if (editingAnnotation.value) {
    void updateExisting(editingAnnotation.value.id, type, color);
    return;
  }

  if (!selectedCFI.value || !selectedText.value) return;
  saveAndDraw(type, color, undefined);
}

// 覆盖已有标注的类型+颜色并重绘（高亮→下划线等切换）
async function updateExisting(id: string, type: AnnotationType, color: string) {
  const updated = await updateAnnotationApi(id, {
    annotationType: type,
    color,
  });
  if (updated) {
    // 先擦除旧样式再按新类型/颜色重绘（经 ReaderPort overlayer）
    reader?.eraseAnnotation({ readerAnchors: { epubcfi: updated.location } });
    reader?.drawAnnotation(toDrawnAnnotation(updated));
  } else if (annotationConflict.value && !annotationConflict.value.current) {
    // 改样式没有编辑稿要保留：提示后放弃这次修改，列表由快照收敛。
    useServerAnnotationVersion();
    showToast("这条笔记已在其他设备删除，修改没有保存", "err");
  }
  toolbarVisible.value = false;
}

async function saveAndDraw(type: AnnotationType, color: string, note?: string) {
  const created = await saveAnnotation({
    bookId: props.bookId,
    bookHash: props.checksum ?? "",
    annotationType: type,
    color: color,
    location: selectedCFI.value,
    textContent: selectedText.value,
    // 阅读器无关选择器（换引擎/换版本重锚定用）
    contextBefore: selectedContextBefore.value,
    contextAfter: selectedContextAfter.value,
    sectionIndex: selectedSectionIndex.value,
    note: note,
    chapterLabel: selectedChapterLabel.value || undefined,
  });

  if (created) {
    reader?.drawAnnotation(toDrawnAnnotation(created));
    toolbarVisible.value = false;
  }
}

function onToolbarNewNote() {
  const existing = annotations.value.find(a => a.id === editingAnnotation.value?.id);
  if (existing) {
    selectedCFI.value = existing.location;
    selectedText.value = existing.textContent;
    selectedContextBefore.value = existing.contextBefore;
    selectedContextAfter.value = existing.contextAfter;
    selectedSectionIndex.value = existing.sectionIndex;
    selectedChapterLabel.value = existing.chapterLabel ?? '';
    pendingAnnotationType.value = existing.annotationType;
    pendingColor.value = existing.color;
  }
  editingAnnotation.value = null;
  editingNoteText.value = null;
  annotationAnchors.value = [];
  toolbarVisible.value = false;
  noteModalVisible.value = true;
}

function onToolbarAddNote() {
  toolbarVisible.value = false;
  editingNoteText.value = editingAnnotation.value
    ? (annotations.value.find((a) => a.id === editingAnnotation.value?.id)
        ?.note ?? null)
    : null;
  noteModalVisible.value = true;
}

async function onToolbarRemove(id: string) {
  const loc = editingAnnotation.value?.location;
  const deleted = await deleteAnnotationApi(id);
  if (deleted && loc) {
    reader?.eraseAnnotation({ readerAnchors: { epubcfi: loc } });
    drawAllAnnotations();
  }
  toolbarVisible.value = false;
}

function onNoteCancel() {
  noteModalVisible.value = false;
  // 关掉显示编辑稿的弹窗即放弃这次修改，列表由快照收敛。
  if (annotationConflict.value && !annotationConflict.value.current) useServerAnnotationVersion();
}

async function onNoteSave(noteText: string) {
  noteModalVisible.value = false;
  if (!noteText && !editingAnnotation.value) return;

  const targetId = editingAnnotation.value?.id;
  if (targetId) {
    const updated = await updateAnnotationApi(targetId, { note: noteText });
    if (updated) editingNoteText.value = noteText;
    // 笔记已在其他设备删除：重新打开弹窗显示编辑稿，避免丢失。
    else if (annotationConflict.value && !annotationConflict.value.current) {
      editingNoteText.value = noteText;
      noteModalVisible.value = true;
    }
  } else {
    if (!selectedCFI.value || !selectedText.value) return;
    await saveAndDraw(
      pendingAnnotationType.value,
      pendingColor.value,
      noteText,
    );
  }
}

async function onListPanelJumpTo(annotation: any) {
  const loc: CanonicalLocator = {
    readerAnchors: { epubcfi: annotation.location },
    textQuote: annotation.textContent
      ? {
          exact: annotation.textContent,
          prefix: annotation.contextBefore ?? undefined,
          suffix: annotation.contextAfter ?? undefined,
        }
      : undefined,
    textPosition:
      annotation.sectionIndex != null
        ? { sectionIndex: annotation.sectionIndex, start: -1, end: -1 }
        : undefined,
  };
  try {
    await reader?.goToLocator(loc);
  } catch {
    /* ignore */
  }
  annotationListOpen.value = false;
}

function onListPanelViewNote(annotation: Annotation) {
  annotationAnchors.value = [{ anchorCfi: annotation.location }];
  chooseAnnotation(annotation.id);
  toolbarVisible.value = false;
  noteModalVisible.value = true;
}
async function onListPanelDelete(id: string) {
  const annotation = annotations.value.find((a) => a.id === id);
  if (annotation) {
    const deleted = await deleteAnnotationApi(id);
    if (deleted) {
      reader?.eraseAnnotation({ readerAnchors: { epubcfi: annotation.location } });
      drawAllAnnotations();
    }
  }
}

// ---- Bookmark handlers ----
async function onToggleBookmark() {
  await toggleRemoteBookmark({
    bookId: props.bookId,
    location: currentCfi.value,
    locationType: isPdf.value ? "pdf_page" : "epubcfi",
    fraction: currentFraction.value,
    chapterLabel: currentChapterLabel.value || null,
  });
}

async function onBookmarkJumpTo(b: Bookmark) {
  try {
    await reader?.goToLocator({
      readerAnchors: !isPdf.value ? { epubcfi: b.cfi } : undefined,
      fraction: b.fraction,
    });
  } catch {
    /* ignore */
  }
  bookmarkListOpen.value = false;
}

// ---- Search handlers（全文搜索，EPUB）----
function toggleSearchPanel() {
  if (!qaMinimized.value) qa.close();
  searchOpen.value ? closeSearchPanel() : (searchOpen.value = true);
}

function closeSearchPanel() {
  searchOpen.value = false;
  // 关闭时中止进行中的搜索并清除引擎命中高亮
  searchToken++;
  searching.value = false;
  reader?.clearSearch?.();
}

// 执行搜索：遍历 reader.search 异步迭代器，用 token 防串扰（新搜索即时作废旧迭代）
async function runSearch(query: string) {
  const token = ++searchToken;
  const q = query.trim();

  if (!q) {
    searchResults.value = [];
    searching.value = false;
    hasSearched.value = false;
    reader?.clearSearch?.();
    return;
  }

  searching.value = true;
  hasSearched.value = true;
  searchResults.value = [];
  searchProgress.value = 0;
  const collected: SearchResultItem[] = [];

  try {
    if (!reader?.search) return;
    const onProgress = (p: number) => {
      if (token === searchToken) searchProgress.value = p;
    };
    for await (const r of reader.search(q, onProgress)) {
      if (token !== searchToken) return; // 已被新搜索/关闭作废：丢弃并中止迭代
      const cfi = r.locator.readerAnchors?.epubcfi;
      if (!cfi) continue;
      collected.push({
        cfi,
        excerpt: r.excerpt,
        chapterLabel: r.chapterLabel ?? "",
      });
      searchResults.value = [...collected]; // 增量渲染，结果流式出现
    }
  } catch {
    /* ignore：搜索失败不阻断阅读 */
  } finally {
    if (token === searchToken) {
      searching.value = false;
      searchProgress.value = 1;
    }
  }
}

async function onSearchJumpTo(item: SearchResultItem) {
  try {
    await reader?.goToLocator({ readerAnchors: { epubcfi: item.cfi } });
  } catch {
    /* ignore */
  }
}

// ---- Init view (first page render) ----
async function initView(remoteProgress: ReadingStateSnapshot["progress"]) {
  if (!reader) return;
  const pos = readerProgress.resolveInitialPosition(remoteProgress);
  if (pos && (pos.location || pos.fraction > 0)) {
    // EPUB 用 CFI（失效则 adapter 内部回落 fraction）；PDF 用 fraction
    await reader.goToLocator({
      readerAnchors:
        !isPdf.value && pos.location ? { epubcfi: pos.location } : undefined,
      fraction: pos.fraction,
    });
    return;
  }
  await reader.goToTextStart();
}

// ---- Methods ----
// 阅读器无关的排版设置（供 reader/web/style.getStyles 使用）。
// 边距/栏宽本组件当前用固定值（见 onMounted 里的 renderer 属性），此处对齐。
function toLayoutSettings(): ReaderLayoutSettings {
  return {
    fontSize: settings.fontSize,
    fontFamily: settings.fontFamily,
    lineSpacing: settings.lineSpacing,
    justify: settings.justify,
    flow: settings.flow,
    theme: settings.theme,
    marginPx: settings.margin,
    gapPercent: 5,
    maxColumnCount: 1,
    maxInlineSize: settings.maxWidth,
  };
}

// 排版/主题变更统一经 ReaderPort.applyLayout 注入（含正规主题色、边距、主题模式类）
function applyStyles() {
  if (!isPdf.value) reader?.applyLayout(toLayoutSettings());
}

// ---- Relocate handler（经 ReaderPort 的 relocate 事件）----
let lastRelocatePosition: string | null = null;
function onRelocate(ev: ReaderRelocateEvent) {
  // 翻页/跳转即关闭悬浮的标注工具栏 / 脚注浮层（避免残留在错误位置）。位置不变的 relocate
  // （布局稳定、视口变化）不能关闭，否则用户刚选好的文字会丢失工具栏。
  const position = readerRelocatePosition(ev);
  if (position !== lastRelocatePosition) {
    lastRelocatePosition = position;
    if (toolbarVisible.value) dismissToolbar();
    if (footnoteVisible.value) closeFootnote();
  }
  const fraction = ev.fraction;
  if (fraction > 0) progress.value = fraction;

  const pdfPage = ev.locator.readerAnchors?.pdf?.page;
  if (isPdf.value && typeof pdfPage === "number") {
    // PDF：用真实页号（section index+1），忽略 SectionProgress 的字符估算 ev.page（会滞后/错位）。
    // totalPages 已在 onMounted 由 book.sections.length 设定，不覆盖。
    currentPage.value = pdfPage;
    if (totalPages.value > 0) progress.value = pdfPage / totalPages.value;
  } else if (ev.page) {
    currentPage.value = ev.page.current || 1;
    totalPages.value = ev.page.total || 1;
  }

  if (ev.tocHref) currentTocHref.value = ev.tocHref;
  if (tocView && ev.tocHref) tocView.setCurrentHref(ev.tocHref);

  // 记录当前定位供书签使用（EPUB=CFI，PDF=page:N）
  currentCfi.value = isPdf.value
    ? `page:${currentPage.value}`
    : (ev.locator.readerAnchors?.epubcfi ?? "");
  currentFraction.value = fraction;
  const tocLabel =
    ev.tocLabel || (isPdf.value ? `第 ${currentPage.value} 页` : "");
  if (tocLabel) currentChapterLabel.value = tocLabel;

  // 进度持久化 + 后端同步（rAF 合并、后台/卸载 flush）交给 useReaderProgress
  readerProgress.record(
    isPdf.value
      ? {
          location: `page:${currentPage.value}`,
          fraction,
          locationType: "pdf_page",
        }
      : {
          location: ev.locator.readerAnchors?.epubcfi ?? "",
          fraction,
          locationType: "epubcfi",
        },
  );
}

// ---- TOC ----
function buildTOC() {
  if (!reader || !tocContainer.value) return;
  mobileTocItems.value = reader.getToc();
  tocView = engineHost.mountToc(tocContainer.value, reader, (href) => {
    void navigateFromToc(href);
  });
}

async function navigateFromToc(href: string) {
  if (tocNavigating.value) return;
  tocNavigating.value = true;
  try {
    if (await readingSession.navigate(href)) sidebarOpen.value = false;
  } finally { tocNavigating.value = false; }
}

// ---- Navigation ----
function goPrev() {
  reader?.prev();
}

function goNext() {
  reader?.next();
}

function onPageChange() {
  let val = Number(currentPage.value);
  if (isNaN(val) || val < 1) val = 1;
  if (val > totalPages.value) val = totalPages.value;
  currentPage.value = val;
  // 用页中点分数 (val-0.5)/total（EPUB/PDF 统一）：避免 val/total 落在页边界被
  // getSection 舍入到下一页（跳 100 变 101）。
  const frac = (val - 0.5) / totalPages.value;
  reader?.goToFraction(frac);
}

function onProgressInput(e: Event) {
  const val = parseFloat((e.target as HTMLInputElement).value);
  if (reader && !isNaN(val)) {
    progress.value = val;
    reader.goToFraction(val);
  }
}

// ---- Keyboard ----
function onKeydown(e: KeyboardEvent) {
  if (qa.state.open && !qaMinimized.value) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (qa.state.preview) qa.state.preview = null;
      else qa.close();
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") return;
  }
  const isFormControl =
    e.target instanceof HTMLInputElement ||
    e.target instanceof HTMLSelectElement ||
    e.target instanceof HTMLTextAreaElement;
  const isEditable =
    e.target instanceof HTMLElement && e.target.isContentEditable;
  if ((isFormControl || isEditable) && e.key !== "Escape") return;
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    if (
      interactionState.value.blocked ||
      noteModalVisible.value ||
      e.altKey ||
      e.ctrlKey ||
      e.metaKey ||
      e.shiftKey ||
      window.getSelection()?.toString().trim()
    )
      return;
  }

  switch (e.key) {
    case "ArrowLeft":
      e.preventDefault();
      goPrev();
      break;
    case "ArrowRight":
      e.preventDefault();
      goNext();
      break;
    case "Escape":
      e.preventDefault();
      switch (
        resolveReaderEscapeAction({
          footnoteVisible: footnoteVisible.value,
          toolbarVisible: toolbarVisible.value,
          noteModalVisible: noteModalVisible.value,
          searchOpen: searchOpen.value,
          sidebarOpen: sidebarOpen.value,
          settingsOpen: settingsOpen.value,
        })
      ) {
        case "close_footnote":
          closeFootnote();
          break;
        case "close_toolbar":
          dismissToolbar();
          break;
        case "close_note_modal":
          noteModalVisible.value = false;
          break;
        case "close_search":
          closeSearchPanel();
          break;
        case "close_sidebar":
          sidebarOpen.value = false;
          break;
        case "close_settings":
          settingsOpen.value = false;
          break;
        case "close_reader":
          emit("close");
          break;
      }
      break;
  }
}

// ---- Settings watchers ----
watch(() => [settings.fontSize, settings.fontFamily], applyStyles);

watch(
  () => [settings.lineSpacing, settings.justify] as const,
  () => {
    applyStyles();
  },
);

watch(() => settings.theme, applyStyles);

// flow(分页/滚动)、边距、页宽也由 applyLayout 统一注入
watch(() => settings.flow, applyStyles);
watch(() => [settings.margin, settings.maxWidth] as const, applyStyles);

watch(pdfZoom, (val) => {
  if (!isPdf.value) return;
  if (val === "fit-width") {
    applyPdfZoom(val);
  } else {
    schedulePdfZoomApply(val);
  }
});

watch(pdfLayout, () => {
  void applyPdfLayout();
});
</script>

<style>
/*
 * 阅读器外壳（封面流 P8，阅读层）：颜色全部来自 --ui-*，由 styles.css 按阅读主题重新定义；
 * 栏的底色和字色跟正文（--rd-paper / --rd-ink），书色 --rd-ac 只用于进度条。
 * 这里是全局样式：批注、书签、搜索面板和目录也复用 .rd-panel / .rd-ib / .rd-row 等类。
 */
.book-reader {
  font-family: var(--ui-font-sans);
  color: var(--rd-ink);
}

/* ===== 顶栏 / 底栏 ===== */
.rd-bar {
  position: absolute;
  left: 0;
  right: 0;
  z-index: var(--ui-z-nav);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  font-size: 13px;
  background: color-mix(in srgb, var(--rd-paper) 92%, transparent);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
  color: color-mix(in srgb, var(--rd-ink) 72%, transparent);
}
.rd-bar--top {
  top: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--rd-ink) 9%, transparent);
}
.rd-bar--bottom {
  bottom: 0;
  flex-wrap: wrap;
  border-top: 1px solid color-mix(in srgb, var(--rd-ink) 9%, transparent);
}
.rd-bar__group {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
}

/* 图标按钮：34px 圆形，弱化的墨色；打开中的面板对应按钮加浅底 */
.rd-ib {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 34px;
  min-width: 34px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.rd-ib:hover {
  background: color-mix(in srgb, var(--rd-ink) 8%, transparent);
  color: var(--rd-ink);
}
.rd-ib--on {
  background: color-mix(in srgb, var(--rd-ink) 10%, transparent);
  color: var(--rd-ink);
}
.rd-ib--filled svg {
  fill: currentColor;
}
.rd-ib--aa {
  font-size: 14px;
  font-weight: 900;
}
.rd-ib--danger:hover {
  background: color-mix(in srgb, var(--ui-err) 14%, transparent);
  color: var(--ui-err);
}
.rd-ib:focus-visible {
  outline: 2px solid var(--ui-fg);
  outline-offset: 1px;
}
.rd-back {
  padding: 0 10px 0 6px;
}
.rd-back__label {
  font-size: 13px;
}

.rd-heading {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1.3;
  text-align: center;
}
.rd-heading__title,
.rd-heading__sub {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rd-heading__title {
  color: var(--rd-ink);
  font-size: 13px;
  font-weight: 700;
}
.rd-heading__sub {
  font-size: 11px;
}
.rd-sync {
  flex: none;
  font-size: 11px;
}
.rd-sync--err {
  color: var(--ui-err);
  font-weight: 700;
}

/* ===== 进度（书色）、页码、PDF 工具 ===== */
.rd-progress {
  flex: 1 1 160px;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 6px;
}
.rd-progress .rd-range {
  flex: 1;
  min-width: 0;
  width: 0;
}
.rd-progress__pct,
.rd-progress__page {
  flex: none;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.rd-progress__page {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.rd-page-input {
  width: 2.6rem;
  text-align: center;
  background: transparent;
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--rd-ink) 25%, transparent);
  color: var(--rd-ink);
  padding: 0;
  font: inherit;
  font-weight: 700;
}
.rd-page-input:focus {
  outline: none;
  border-bottom-color: var(--rd-ac);
}
.rd-pdf-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.rd-zoom {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.rd-zoom__value {
  min-width: 4.2em;
  text-align: right;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

/* 底栏里的小分段按钮（PDF 单页/双页）；e2e 按 button 找，所以不用 UiSegmented 的 radio */
.rd-seg {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--rd-ink) 7%, transparent);
}
.rd-seg__item {
  border: 0;
  border-radius: 999px;
  padding: 3px 11px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.rd-seg__item--on {
  background: var(--rd-paper);
  color: var(--rd-ink);
  font-weight: 700;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
}

/* ===== 滑块：--rd-fill 是已选比例；默认用前景色，进度条用书色 ===== */
.rd-range {
  --rd-range-color: var(--ui-fg);
  --rd-range-track: var(--ui-surface2);
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(to right, var(--rd-range-color) var(--rd-fill, 0%), var(--rd-range-track) var(--rd-fill, 0%));
  cursor: pointer;
}
.rd-range--accent {
  --rd-range-color: var(--rd-ac);
  --rd-range-track: color-mix(in srgb, var(--rd-ink) 12%, transparent);
}
.rd-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--rd-range-color);
  border: 0;
  cursor: pointer;
}
.rd-range::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--rd-range-color);
  border: 0;
  cursor: pointer;
}
.rd-range--accent::-webkit-slider-thumb {
  box-shadow: 0 0 0 3px var(--rd-paper);
}
.rd-range--accent::-moz-range-thumb {
  box-shadow: 0 0 0 3px var(--rd-paper);
}
.rd-range:focus-visible {
  outline: 2px solid var(--ui-fg);
  outline-offset: 4px;
}

/* ===== 阅读设置：沿用外壳卡片样式；手机从底栏上方弹出 ===== */
.rd-settings {
  position: absolute;
  top: calc(var(--rd-bar-top, 0px) + 8px);
  right: 14px;
  z-index: var(--ui-z-dropdown);
  width: 300px;
  max-height: calc(100% - var(--rd-bar-top, 0px) - var(--rd-bar-bottom, 0px) - 16px);
  overflow-y: auto;
  display: grid;
  gap: 14px;
  padding: 16px;
  background: var(--ui-surface);
  color: var(--ui-fg);
  border: 1px solid var(--ui-line);
  border-radius: 18px;
  box-shadow: 0 24px 50px -18px var(--ui-shadow);
  font-size: 13px;
}
.rd-settings__row {
  display: grid;
  gap: 6px;
  min-width: 0;
}
.rd-settings__label {
  font-size: 12px;
  font-weight: 500;
  color: var(--ui-muted);
}
.rd-settings__label small {
  margin-left: 4px;
  font-variant-numeric: tabular-nums;
}
.rd-settings .rd-range {
  width: 100%;
}
.rd-slider {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--ui-muted);
}
.rd-slider .rd-range {
  flex: 1;
  min-width: 0;
}
.rd-slider__big {
  font-size: 17px;
}
.rd-themes {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.rd-themes__item {
  border: 1px solid var(--ui-line);
  border-radius: 12px;
  padding: 10px 6px;
  font: inherit;
  font-family: var(--ui-font-serif);
  font-size: 12px;
  cursor: pointer;
}
.rd-themes__item--on {
  outline: 2px solid var(--ui-fg);
  outline-offset: 1px;
  font-weight: 700;
}
.rd-themes__item:focus-visible {
  outline: 2px solid var(--ui-fg);
  outline-offset: 3px;
}
.rd-check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  cursor: pointer;
}
.rd-check input {
  width: 16px;
  height: 16px;
  accent-color: var(--ui-strong);
  cursor: pointer;
}
@media (max-width: 767px) {
  .rd-settings {
    top: auto;
    left: 0;
    right: 0;
    bottom: var(--rd-bar-bottom, 0px);
    width: auto;
    max-height: 72%;
    border-radius: 20px 20px 0 0;
    border-bottom-width: 0;
  }
}
.rd-pop-enter-active,
.rd-pop-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.rd-pop-enter-from,
.rd-pop-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
@media (max-width: 767px) {
  .rd-pop-enter-from,
  .rd-pop-leave-to {
    transform: translateY(16px);
  }
}

/* ===== 侧面板（目录、批注、书签、搜索） ===== */
.rd-panel {
  background: var(--ui-surface);
  border-color: var(--ui-line);
  color: var(--ui-fg);
  box-shadow: 0 24px 50px -24px var(--ui-shadow);
}
/* 目录面板贴在浮动的顶/底栏之间，避免压住底栏上开关自己的按钮。
   阅读区不用内缩——栏是浮层，内容满高，所以切换沉浸式不会重排正文。 */
.rd-inset-panel {
  top: var(--rd-bar-top, 0px);
  bottom: var(--rd-bar-bottom, 0px);
  transition: top 0.25s ease, bottom 0.25s ease;
}
.rd-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}
.rd-panel__title {
  margin: 0;
  font-size: 15px;
  font-weight: 900;
  color: var(--ui-fg);
}
.rd-panel__title small {
  margin-left: 4px;
  font-size: 12px;
  font-weight: 500;
  color: var(--ui-muted);
}
.rd-panel .rd-ib {
  color: var(--ui-muted);
}
.rd-panel .rd-ib:hover {
  background: var(--ui-surface2);
  color: var(--ui-fg);
}
.rd-panel .rd-ib--danger:hover {
  background: color-mix(in srgb, var(--ui-err) 14%, transparent);
  color: var(--ui-err);
}
.rd-muted-text {
  color: var(--ui-muted);
}
.rd-body-text {
  color: var(--ui-fg2);
}
.rd-empty {
  padding: 32px 0;
  text-align: center;
  font-size: 13px;
  color: var(--ui-muted);
}
.rd-error-text {
  font-size: 13px;
  color: var(--ui-err);
}
.rd-row {
  border-bottom: 1px solid var(--ui-line);
  cursor: pointer;
  border-radius: 10px;
  transition: background-color 0.15s ease;
}
.rd-row:hover {
  background: var(--ui-surface2);
}
.rd-row:focus-visible {
  outline: 2px solid var(--ui-fg);
  outline-offset: -2px;
}
.rd-note-box {
  background: var(--ui-surface2);
  color: var(--ui-fg2);
}
.rd-group-head {
  color: var(--ui-muted);
  background: var(--ui-surface2);
}
.rd-mark {
  background: color-mix(in srgb, var(--ui-warn) 30%, transparent);
  color: inherit;
  padding: 0 1px;
}

/* ===== 加载、出错、断线、冲突 ===== */
.rd-state {
  position: absolute;
  inset: 0;
  z-index: var(--ui-z-sticky);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 24px;
  text-align: center;
}
.rd-state__text {
  font-size: 13px;
  color: color-mix(in srgb, var(--rd-ink) 65%, transparent);
}
.rd-spinner {
  width: 32px;
  height: 32px;
  border-radius: 9999px;
  border: 2px solid color-mix(in srgb, var(--rd-ink) 14%, transparent);
  border-top-color: var(--rd-ac);
  animation: rd-spin 0.8s linear infinite;
}
@keyframes rd-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .rd-spinner {
    animation-duration: 2.4s;
  }
}
.rd-blocker {
  position: fixed;
  inset: 0;
  z-index: var(--ui-z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: var(--ui-scrim);
}
.rd-card {
  width: min(92vw, 380px);
  padding: 18px 20px;
  background: var(--ui-surface);
  color: var(--ui-fg);
  border: 1px solid var(--ui-line);
  border-radius: var(--ui-radius-card);
  box-shadow: 0 24px 50px -18px var(--ui-shadow);
  text-align: left;
}
.rd-card__title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
}
.rd-card__text {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--ui-muted);
}
.rd-card__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}
.rd-conflict {
  position: fixed;
  left: 50%;
  top: 72px;
  z-index: var(--ui-z-modal);
  width: min(92vw, 440px);
  transform: translateX(-50%);
  border-color: color-mix(in srgb, var(--ui-warn) 45%, transparent);
}

.qa-minimized {
  position: absolute;
  right: 12px;
  bottom: calc(var(--rd-bar-bottom, 0px) + 12px);
  z-index: var(--ui-z-dropdown);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--ui-line);
  border-radius: 999px;
  padding: 9px 16px;
  background: var(--ui-surface);
  color: var(--ui-fg);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  box-shadow: 0 12px 30px -12px var(--ui-shadow);
  cursor: pointer;
}

.book-reader .rd-edge-hint {
  position: absolute;
  top: 0;
  bottom: 0;
  width: clamp(40px, 10%, 80px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--ui-z-raised);
  pointer-events: none;
  color: var(--rd-ink);
}
.book-reader .rd-edge-hint svg {
  opacity: 0.8;
}
.book-reader .rd-edge-hint--left {
  left: 0;
  background: linear-gradient(to right, color-mix(in srgb, var(--rd-ink) 14%, transparent), transparent);
}
.book-reader .rd-edge-hint--right {
  right: 0;
  background: linear-gradient(to left, color-mix(in srgb, var(--rd-ink) 14%, transparent), transparent);
}

/* foliate-view 填满容器 */
.book-reader foliate-view {
  display: block;
  width: 100%;
  height: 100%;
  --overlayer-highlight-opacity: 0.35;
  --overlayer-highlight-blend-mode: multiply;
}

/* 手机：返回按钮只留图标（文字保留给读屏和 e2e 的按钮名“书架”） */
@media (max-width: 640px) {
  .rd-bar {
    padding: 6px 8px;
  }
  .rd-back {
    padding: 0;
  }
  .rd-back__label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .rd-sync {
    max-width: 5em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

/* TOC 树样式 */
.toc-tree ol {
  list-style: none;
  padding: 0;
  margin: 0;
}

.toc-tree a,
.toc-tree span {
  display: block;
  padding: 5px 8px;
  font-size: 13px;
  color: var(--ui-fg2);
  text-decoration: none;
  cursor: pointer;
  line-height: 1.6;
  border-radius: 8px;
  transition: color 0.15s ease, background-color 0.15s ease;
}

.toc-tree a:hover {
  color: var(--ui-fg);
  background: var(--ui-surface2);
}

.toc-tree a[aria-current] {
  font-weight: 700;
  color: var(--ui-fg);
  background: var(--ui-surface2);
}

.toc-tree a svg {
  margin-right: 4px;
  vertical-align: middle;
  transition: transform 0.2s;
}

.toc-tree a[aria-expanded="true"] svg {
  transform: rotate(90deg);
}

.toc-tree a[aria-expanded="false"] ~ ol[role="group"] {
  display: none;
}

/* 侧边栏滑入动画 */
.slide-left-enter-active,
.slide-left-leave-active,
.slide-right-enter-active,
.slide-right-leave-active,
.slide-down-enter-active,
.slide-down-leave-active,
.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 0.25s ease, opacity 0.25s ease;
}
.slide-left-enter-from,
.slide-left-leave-to {
  transform: translateX(-100%);
  opacity: 0;
}
.slide-right-enter-from,
.slide-right-leave-to {
  transform: translateX(100%);
  opacity: 0;
}
/* 顶/底栏滑入动画（覆盖阅读区，不参与布局） */
.slide-down-enter-from,
.slide-down-leave-to {
  transform: translateY(-100%);
  opacity: 0;
}
.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(100%);
  opacity: 0;
}
</style>
