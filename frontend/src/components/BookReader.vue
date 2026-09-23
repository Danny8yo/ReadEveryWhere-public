<template>
  <div
    class="book-reader fixed inset-0 z-50 flex flex-col"
    :class="`theme-${settings.theme}`"
    :style="barInsetStyle"
  >
    <!-- 顶部栏（覆盖在阅读区之上，切换时不改变阅读区尺寸） -->
    <Transition name="slide-down">
      <header
        ref="headerEl"
        v-show="uiVisible"
        class="rd-bar absolute top-0 left-0 right-0 z-30 flex items-center gap-2 px-3 py-2 border-b"
      >
        <button class="rd-icon-btn" title="返回书架" @click="emit('close')">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
          <span class="rd-btn-label">书架</span>
        </button>

        <span class="rd-title flex-1 min-w-0 text-center truncate px-2">
          {{ bookMetadata.title }}
        </span>

        <span
          v-if="syncMessage"
          class="text-[11px] shrink-0"
          :class="syncFailed ? 'text-red-500' : 'rd-muted-text'"
          role="status"
        >
          {{ syncMessage }}
        </span>

        <div class="flex items-center gap-1">
          <button
            v-if="!isPdf"
            class="rd-icon-btn"
            :class="{ 'rd-icon-btn--active': searchOpen }"
            title="全文搜索"
            @click="toggleSearchPanel"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </button>
          <button
            v-if="bookFormat === 'epub'"
            data-testid="selection-qa-open"
            class="rd-icon-btn"
            title="选区问答与本书记录"
            @click="openQaRecords"
          >
            问答
          </button>
          <button
            class="rd-icon-btn"
            :class="{ 'rd-icon-btn--active': currentBookmarked }"
            :title="currentBookmarked ? '移除书签' : '添加书签'"
            @click="onToggleBookmark"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              :fill="currentBookmarked ? 'currentColor' : 'none'"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M6 2a2 2 0 0 0-2 2v18l8-5.5 8 5.5V4a2 2 0 0 0-2-2z" />
            </svg>
          </button>
          <button
            class="rd-icon-btn rd-icon-btn--aa"
            :class="{ 'rd-icon-btn--active': settingsOpen }"
            title="阅读设置"
            @click="toggleSettingsPanel"
          >
            Aa
          </button>
        </div>
      </header>
    </Transition>

    <div class="flex flex-1 overflow-hidden relative">
      <!-- 左侧目录 -->
      <Transition name="slide-left">
        <aside
          v-show="sidebarOpen"
          class="rd-panel rd-inset-panel absolute left-0 z-30 w-72 border-r overflow-y-auto hidden md:block"
        >
          <div class="p-5">
            <h3 class="rd-label mb-4">目录</h3>
            <div ref="tocContainer" class="toc-tree"></div>
            <p
              v-if="tocNavigationError"
              role="alert"
              class="mt-3 text-xs text-red-500"
            >
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
          class="absolute inset-0 flex flex-col items-center justify-center gap-4 z-20"
          :style="{ background: bgColor }"
        >
          <div class="rd-spinner" />
          <span class="text-sm rd-muted-text font-serif">{{
            loadingMessage
          }}</span>
        </div>

        <!-- 错误覆盖层 -->
        <div
          v-else-if="error"
          class="absolute inset-0 flex flex-col items-center justify-center gap-4 z-20"
          :style="{ background: bgColor }"
        >
          <span class="text-sm text-red-500">{{ error }}</span>
          <button class="rd-text-btn" @click="emit('close')">返回书架</button>
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
        class="fixed inset-0 z-[100] flex items-center justify-center bg-black/35"
        role="alert"
      >
        <div
          class="w-[min(90vw,360px)] border border-gray-200 bg-white p-5 text-center shadow-xl"
        >
          <p class="text-sm font-semibold text-gray-900">阅读连接已中断</p>
          <p class="mt-2 text-xs text-gray-600">
            正在重新连接服务器，连接恢复后会自动刷新阅读状态。
          </p>
        </div>
      </div>

      <!-- 右侧设置面板 -->
      <Transition name="slide-right">
        <aside
          v-if="settingsOpen"
          class="rd-panel rd-inset-panel absolute right-0 z-30 w-80 border-l overflow-y-auto"
        >
          <div class="p-5 space-y-6">
            <h3 class="rd-label">阅读设置</h3>

            <!-- 字号 -->
            <label v-if="!isPdf" class="block space-y-2">
              <span class="rd-label flex items-center justify-between"
                >字号
                <span class="rd-value">{{ settings.fontSize }}px</span></span
              >
              <input
                type="range"
                min="12"
                max="28"
                step="1"
                v-model.number="settings.fontSize"
                class="rd-range"
              />
            </label>

            <!-- 字体 -->
            <label v-if="!isPdf" class="block space-y-2">
              <span class="rd-label">字体</span>
              <select v-model="settings.fontFamily" class="rd-select">
                <option value="serif">衬线体 (Serif)</option>
                <option value="sans-serif">无衬线体 (Sans)</option>
                <option value="system-ui">系统默认</option>
              </select>
            </label>

            <!-- 行距 -->
            <label v-if="!isPdf" class="block space-y-2">
              <span class="rd-label">行距</span>
              <select v-model.number="settings.lineSpacing" class="rd-select">
                <option :value="1.2">窄</option>
                <option :value="1.5">标准</option>
                <option :value="1.8">宽</option>
                <option :value="2.0">很宽</option>
              </select>
            </label>

            <!-- 页边距 -->
            <label v-if="!isPdf" class="block space-y-2">
              <span class="rd-label flex items-center justify-between"
                >页边距
                <span class="rd-value">{{ settings.margin }}px</span></span
              >
              <input
                type="range"
                min="0"
                max="80"
                step="4"
                v-model.number="settings.margin"
                class="rd-range"
              />
            </label>

            <!-- 页面宽度 -->
            <label v-if="!isPdf" class="block space-y-2">
              <span class="rd-label flex items-center justify-between"
                >页面宽度
                <span class="rd-value">{{ settings.maxWidth }}px</span></span
              >
              <input
                type="range"
                min="600"
                max="1600"
                step="50"
                v-model.number="settings.maxWidth"
                class="rd-range"
              />
            </label>

            <!-- 主题 -->
            <fieldset class="space-y-2">
              <legend class="rd-label mb-2">主题</legend>
              <div class="rd-seg">
                <label
                  v-for="t in ['light', 'dark', 'sepia'] as const"
                  :key="t"
                  class="flex-1 cursor-pointer"
                >
                  <input
                    type="radio"
                    :value="t"
                    v-model="settings.theme"
                    class="sr-only"
                  />
                  <span
                    class="rd-seg-item"
                    :class="{ 'rd-seg-item--active': settings.theme === t }"
                  >
                    {{
                      t === "light" ? "明亮" : t === "dark" ? "暗黑" : "羊皮"
                    }}
                  </span>
                </label>
              </div>
            </fieldset>

            <!-- 两端对齐 -->
            <label v-if="!isPdf" class="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                v-model="settings.justify"
                class="rd-check"
              />
              <span class="rd-label">两端对齐</span>
            </label>

            <!-- 翻页模式 -->
            <fieldset v-if="!isPdf" class="space-y-2">
              <legend class="rd-label mb-2">翻页模式</legend>
              <div class="rd-seg">
                <label
                  v-for="m in ['paginated', 'scrolled'] as const"
                  :key="m"
                  class="flex-1 cursor-pointer"
                >
                  <input
                    type="radio"
                    :value="m"
                    v-model="settings.flow"
                    class="sr-only"
                  />
                  <span
                    class="rd-seg-item"
                    :class="{ 'rd-seg-item--active': settings.flow === m }"
                  >
                    {{ m === "paginated" ? "分页" : "滚动" }}
                  </span>
                </label>
              </div>
            </fieldset>
          </div>
        </aside>
      </Transition>

      <SelectionQaSidebar v-if="qa.state.open" v-show="!qaMinimized" :qa="qa" :book-title="bookMetadata.title" @minimize="minimizeQa" />
      <button v-if="qa.state.open && qaMinimized" class="qa-minimized" data-testid="selection-qa-restore"
        aria-label="恢复选区问答" @click="restoreQa">
        问答 · {{ qaMinimizedStatus }} <span aria-hidden="true">↗</span>
      </button>
    </div>

    <!-- 底部进度条（覆盖在阅读区之上） -->
    <Transition name="slide-up">
      <footer
        ref="footerEl"
        v-show="uiVisible"
        class="rd-bar absolute bottom-0 left-0 right-0 z-30 flex flex-wrap items-center gap-3 px-4 py-2.5 border-t"
      >
        <div class="flex items-center gap-1 shrink-0">
          <button
            class="rd-icon-btn"
            title="目录"
            @click="
              if (!qaMinimized) qa.close();
              sidebarOpen = !sidebarOpen;
            "
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
            <span class="rd-btn-label">目录</span>
          </button>

          <button
            class="rd-icon-btn"
            title="批注"
            @click="
              if (!qaMinimized) qa.close();
              annotationListOpen = !annotationListOpen;
            "
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
            <span class="rd-btn-label">批注</span>
          </button>

          <button
            class="rd-icon-btn"
            title="书签"
            @click="bookmarkListOpen = !bookmarkListOpen"
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M6 2a2 2 0 0 0-2 2v18l8-5.5 8 5.5V4a2 2 0 0 0-2-2z" />
            </svg>
            <span class="rd-btn-label">书签</span>
          </button>
        </div>

        <!-- PDF 布局与缩放控件 -->
        <div v-if="isPdf" class="flex flex-wrap items-center gap-3 min-w-0">
          <div class="rd-seg">
            <button
              v-for="mode in pdfLayoutOptions"
              :key="mode.value"
              type="button"
              class="rd-seg-item px-3"
              :class="{ 'rd-seg-item--active': pdfLayout === mode.value }"
              @click="setPdfLayout(mode.value)"
            >
              {{ mode.label }}
            </button>
          </div>

          <label class="flex items-center gap-2 rd-value">
            <span class="min-w-[4rem] text-right">{{ pdfZoomLabel }}</span>
            <input
              type="range"
              :min="PDF_ZOOM_MIN_PERCENT"
              :max="PDF_ZOOM_MAX_PERCENT"
              :step="PDF_ZOOM_STEP_PERCENT"
              :value="pdfZoomPercent"
              class="rd-range w-32"
              title="缩放"
              @input="onPdfZoomInput"
            />
            <button
              type="button"
              @click="pdfZoomReset"
              class="rd-text-btn rd-text-btn--sm"
            >
              适应宽度
            </button>
          </label>
        </div>

        <div
          class="flex items-center gap-2.5 basis-full min-w-0 sm:basis-0 sm:flex-1 max-w-2xl mx-auto"
        >
          <button class="rd-icon-btn" title="上一页" @click="goPrev">
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>

          <div class="rd-chip">
            <!-- PDF：真实页可精确跳转，显示页码输入；EPUB：无真实页，显示阅读进度%(仿 readest) -->
            <template v-if="isPdf">
              <input
                type="number"
                min="1"
                :max="totalPages"
                v-model.lazy="currentPage"
                @change="onPageChange"
                class="rd-page-input [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span class="rd-chip-total">/ {{ totalPages }}</span>
            </template>
            <span v-else class="rd-chip-total">{{ progressPct }}%</span>
          </div>

          <input
            type="range"
            min="0"
            max="1"
            step="0.001"
            :value="progress"
            @input="onProgressInput"
            class="rd-range min-w-0 w-0 flex-1"
          />

          <button class="rd-icon-btn" title="下一页" @click="goNext">
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
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
      @select-annotation="chooseAnnotation"
      @save="onNoteSave"
      @cancel="noteModalVisible = false"
    />

    <div
      v-if="annotationConflict"
      class="fixed left-1/2 top-20 z-[120] w-[min(92vw,440px)] -translate-x-1/2 border border-amber-300 bg-white p-4 shadow-xl"
      role="alert"
    >
      <p class="text-sm font-semibold text-gray-900">该批注已在其他设备修改</p>
      <p class="mt-1 text-xs text-gray-600">
        请选择使用服务器版本，或基于最新版本重新提交当前操作。
      </p>
      <div class="mt-3 flex justify-end gap-2">
        <button class="rd-text-btn" @click="onUseServerAnnotationVersion">
          使用服务器版本
        </button>
        <button class="rd-text-btn" @click="onPrepareAnnotationConflictRetry">
          重新编辑后保存
        </button>
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
      @close="closeFootnote"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import {
  createReadingSessionState,
  createReadingSession,
} from "../features/reader/domain/session";
import { reactive, toRef, nextTick } from "vue";
import { createWebReaderHost } from "../features/reader/web/engineHost";
import SelectionQaSidebar from "./selection-qa/SelectionQaSidebar.vue";
import { useSelectionQa } from "../features/selection-qa/web/useSelectionQa";
import { selectionRequest } from "../features/selection-qa/domain/protocol";
import type {
  LoadedEpubIdentity,
  EpubSelectionAnchor,
} from "../features/selection-qa/model/selectionQa";
import AnnotationToolbar from "./AnnotationToolbar.vue";
import MobileReaderToc from "./MobileReaderToc.vue";
import type { TocItem } from "../features/reader/domain/ReaderPort";
import AnnotationNoteModal from "./AnnotationNoteModal.vue";
import AnnotationListPanel from "./AnnotationListPanel.vue";
import BookmarkListPanel from "./BookmarkListPanel.vue";
import SearchPanel from "./SearchPanel.vue";
import FootnotePopup from "./FootnotePopup.vue";
import type { SearchResultItem } from "../lib/reader/searchResults";
import { useAnnotations } from "../composables/useAnnotations";
import { toBookmark } from "../features/reader/domain/bookmarkCommands";
import { useBookmarks } from "../features/reader/web/useBookmarks";
import {
  isBookmarked,
  toggleBookmark,
  type Bookmark,
} from "../lib/reader/bookmarks";
import { createReaderSourceLoader } from "../features/reader/web/sourceLoader";
import type {
  Annotation,
  AnnotationType,
} from "../features/reader/model/annotation";
import { shouldDownloadPdfWhole } from "../lib/reader/pdfLoadStrategy";
import { resolvePdfLoadingMode } from "../lib/reader/pdfLoadingMode";
import { getBookFormat, getBookFormatMimeType } from "../utils/bookFormat";
import { getThemeCode } from "../lib/reader/themes";
import { annotationsForSection } from "../lib/reader/annotations";
import {
  canTurnByEdge,
  resolveReaderTapAction,
  type ReaderInteractionState,
} from "../lib/reader/interaction";
import { resolveReaderEscapeAction } from "../lib/reader/escape";
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
} from "../features/reader/domain/ReaderPort";
import type { ReaderSource } from "../features/reader/web/WebReaderPort";

import { useReaderSettings } from "../composables/reader/useReaderSettings";
import { useReaderUI } from "../composables/reader/useReaderUI";
import { useReaderProgress } from "../composables/reader/useReaderProgress";
import { useReadingStateSync } from "../composables/reader/useReadingStateSync";
import type { ReadingStateSnapshot } from "../features/reader/model/readingState";
import {
  usePdfViewSettings,
  clampPdfZoomPercent,
  PDF_ZOOM_MIN_PERCENT,
  PDF_ZOOM_MAX_PERCENT,
  PDF_ZOOM_STEP_PERCENT,
  type PdfLayout,
  type PdfZoom,
} from "../composables/reader/usePdfViewSettings";

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
  return turn.status === 'completed' ? '已完成' : '未完成';
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
  if (annotationConflict.value) return "批注存在冲突";
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

async function onNoteSave(noteText: string) {
  noteModalVisible.value = false;
  if (!noteText && !editingAnnotation.value) return;

  const targetId = editingAnnotation.value?.id;
  if (targetId) {
    const updated = await updateAnnotationApi(targetId, { note: noteText });
    if (updated) editingNoteText.value = noteText;
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
// 阅读器无关的排版设置（供 lib/reader/style.getStyles 使用）。
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
function onRelocate(ev: ReaderRelocateEvent) {
  // 翻页/跳转即关闭悬浮的标注工具栏 / 脚注浮层（避免残留在错误位置）
  if (toolbarVisible.value) dismissToolbar();
  if (footnoteVisible.value) closeFootnote();
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
.qa-minimized { position: absolute; right: 12px; bottom: calc(var(--rd-bar-bottom, 0px) + 12px); z-index: 55; border: 1px solid var(--rd-border); border-radius: 12px; padding: 10px 16px; background: var(--rd-surface-solid, #fff); color: var(--rd-fg); box-shadow: 0 4px 18px #0002; }

.book-reader .rd-edge-hint {
  position: absolute;
  top: 0;
  bottom: 0;
  width: clamp(40px, 10%, 80px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  pointer-events: none;
  color: var(--rd-fg);
}
.book-reader .rd-edge-hint svg {
  opacity: 0.8;
}
.book-reader .rd-edge-hint--left {
  left: 0;
  background: linear-gradient(
    to right,
    color-mix(in srgb, var(--rd-fg) 14%, transparent),
    transparent
  );
}
.book-reader .rd-edge-hint--right {
  right: 0;
  background: linear-gradient(
    to left,
    color-mix(in srgb, var(--rd-fg) 14%, transparent),
    transparent
  );
}

/* foliate-view 填满容器 */
.book-reader foliate-view {
  display: block;
  width: 100%;
  height: 100%;
  --overlayer-highlight-opacity: 0.35;
  --overlayer-highlight-blend-mode: multiply;
}

/* ===== 阅读器外壳设计令牌（三主题协调） ===== */
.book-reader {
  --reader-bg: #ffffff;
  --rd-surface: rgba(255, 255, 255, 0.82);
  --rd-surface-solid: #ffffff;
  --rd-border: rgba(17, 24, 39, 0.08);
  --rd-fg: #1f2937;
  --rd-title: #374151;
  --rd-muted: #9ca3af;
  --rd-muted-strong: #6b7280;
  --rd-muted-hover: #111827;
  --rd-hover-bg: rgba(17, 24, 39, 0.06);
  --rd-chip-bg: rgba(17, 24, 39, 0.05);
  --rd-track: rgba(17, 24, 39, 0.14);
  --rd-accent: #2563eb;
  --rd-accent-fg: #ffffff;
  --rd-row-hover: rgba(17, 24, 39, 0.04);
  --rd-divider: rgba(17, 24, 39, 0.07);
  --rd-shadow: 0 10px 34px rgba(17, 24, 39, 0.12);
}

.book-reader.theme-light {
  --reader-bg: #ffffff;
}

.book-reader.theme-dark {
  --reader-bg: #1a1a1a;
  --rd-surface: rgba(28, 29, 33, 0.82);
  --rd-surface-solid: #202124;
  --rd-border: rgba(255, 255, 255, 0.1);
  --rd-fg: #e5e7eb;
  --rd-title: #d1d5db;
  --rd-muted: #7f858e;
  --rd-muted-strong: #9ca3af;
  --rd-muted-hover: #f3f4f6;
  --rd-hover-bg: rgba(255, 255, 255, 0.08);
  --rd-chip-bg: rgba(255, 255, 255, 0.07);
  --rd-track: rgba(255, 255, 255, 0.16);
  --rd-accent: #7aa2f7;
  --rd-accent-fg: #10131a;
  --rd-row-hover: rgba(255, 255, 255, 0.05);
  --rd-divider: rgba(255, 255, 255, 0.08);
  --rd-shadow: 0 10px 34px rgba(0, 0, 0, 0.5);
}

.book-reader.theme-sepia {
  --reader-bg: #f5f0e1;
  --rd-surface: rgba(245, 240, 225, 0.86);
  --rd-surface-solid: #f3ecda;
  --rd-border: rgba(91, 70, 54, 0.16);
  --rd-fg: #5b4636;
  --rd-title: #4a3928;
  --rd-muted: #a1917b;
  --rd-muted-strong: #8a795f;
  --rd-muted-hover: #3d2f22;
  --rd-hover-bg: rgba(91, 70, 54, 0.08);
  --rd-chip-bg: rgba(91, 70, 54, 0.08);
  --rd-track: rgba(91, 70, 54, 0.2);
  --rd-accent: #9c7c47;
  --rd-accent-fg: #f7f2e4;
  --rd-row-hover: rgba(91, 70, 54, 0.06);
  --rd-divider: rgba(91, 70, 54, 0.1);
  --rd-shadow: 0 10px 34px rgba(91, 70, 54, 0.18);
}

/* ===== 外壳表面（顶/底栏、侧面板） ===== */
.rd-bar {
  background: var(--rd-surface);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
  border-color: var(--rd-border);
  color: var(--rd-fg);
}

.rd-panel {
  background: var(--rd-surface-solid);
  border-color: var(--rd-border);
  color: var(--rd-fg);
  box-shadow: var(--rd-shadow);
}

/* 目录/设置面板：贴在浮动的顶/底栏之间，避免压住底栏上开关自己的按钮。
   阅读区不用内缩——栏是浮层，内容满高，所以切换沉浸式不会重排正文。 */
.rd-inset-panel {
  top: var(--rd-bar-top, 0px);
  bottom: var(--rd-bar-bottom, 0px);
  transition:
    top 0.25s ease,
    bottom 0.25s ease;
}

.rd-title {
  font-family: ui-serif, Georgia, "Songti SC", serif;
  font-size: 13px;
  color: var(--rd-title);
}

.rd-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--rd-muted);
}

.rd-muted-text {
  color: var(--rd-muted-strong);
}

.rd-body-text {
  color: var(--rd-fg);
}

.rd-value {
  font-size: 11px;
  font-weight: 600;
  color: var(--rd-muted-strong);
}

/* ===== 图标 / 文本按钮 ===== */
.rd-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 34px;
  min-width: 34px;
  padding: 0 9px;
  border-radius: 9px;
  color: var(--rd-muted);
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}
.rd-icon-btn:hover {
  background: var(--rd-hover-bg);
  color: var(--rd-muted-hover);
}
.rd-icon-btn--active {
  color: var(--rd-fg);
  background: var(--rd-chip-bg);
}
.rd-icon-btn--aa {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.02em;
  font-family: ui-serif, Georgia, serif;
}
.rd-icon-btn--danger:hover {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}
.rd-btn-label {
  font-size: 12px;
  font-weight: 600;
}

.rd-text-btn {
  font-size: 12px;
  font-weight: 600;
  color: var(--rd-muted-strong);
  padding: 6px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}
.rd-text-btn:hover {
  background: var(--rd-hover-bg);
  color: var(--rd-muted-hover);
}
.rd-text-btn--sm {
  font-size: 10px;
  padding: 4px 8px;
}

/* ===== 页码 chip ===== */
.rd-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: var(--rd-chip-bg);
  color: var(--rd-fg);
  border-radius: 8px;
  padding: 4px 9px;
}
.rd-chip-total {
  font-size: 11px;
  font-weight: 700;
  color: var(--rd-muted-strong);
}
.rd-page-input {
  width: 2.4rem;
  text-align: center;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--rd-track);
  color: var(--rd-fg);
  padding: 0;
  font-size: 11px;
  font-weight: 700;
}
.rd-page-input:focus {
  outline: none;
  border-bottom-color: var(--rd-accent);
}

/* ===== 分段控件 ===== */
.rd-seg {
  display: flex;
  gap: 3px;
  padding: 3px;
  border-radius: 10px;
  background: var(--rd-chip-bg);
}
.rd-seg-item {
  display: block;
  flex: 1;
  text-align: center;
  cursor: pointer;
  border-radius: 7px;
  padding: 6px 8px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--rd-muted-strong);
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}
.rd-seg-item:hover {
  color: var(--rd-muted-hover);
}
.rd-seg-item--active,
.rd-seg-item--active:hover {
  background: var(--rd-accent);
  color: var(--rd-accent-fg);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.16);
}

/* ===== 表单控件 ===== */
.rd-select {
  width: 100%;
  border: 1px solid var(--rd-border);
  background: var(--rd-chip-bg);
  color: var(--rd-fg);
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.15s ease;
}
.rd-select:focus {
  outline: none;
  border-color: var(--rd-accent);
}
.rd-select option {
  color: initial;
}

.rd-check {
  width: 16px;
  height: 16px;
  accent-color: var(--rd-accent);
  cursor: pointer;
}

/* ===== 滑块 ===== */
.rd-range {
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  border-radius: 999px;
  background: var(--rd-track);
  cursor: pointer;
}
.rd-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  box-sizing: border-box;
  width: 14px;
  height: 14px;
  margin-top: -5px;
  border-radius: 50%;
  background: var(--rd-accent);
  border: 2px solid var(--rd-surface-solid);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.28);
  cursor: pointer;
}
.rd-range::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 999px;
}
.rd-range::-moz-range-thumb {
  box-sizing: border-box;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--rd-accent);
  border: 2px solid var(--rd-surface-solid);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.28);
  cursor: pointer;
}
.rd-range::-moz-range-track {
  height: 4px;
  border-radius: 999px;
  background: var(--rd-track);
}

/* ===== 加载态 ===== */
.rd-spinner {
  width: 32px;
  height: 32px;
  border-radius: 9999px;
  border: 2px solid var(--rd-track);
  border-top-color: var(--rd-accent);
  animation: rd-spin 0.8s linear infinite;
}
@keyframes rd-spin {
  to {
    transform: rotate(360deg);
  }
}

/* ===== 面板列表行（供批注/书签/搜索面板复用） ===== */
.rd-row {
  border-bottom: 1px solid var(--rd-divider);
  cursor: pointer;
  border-radius: 8px;
  transition: background-color 0.15s ease;
}
.rd-row:hover {
  background: var(--rd-row-hover);
}
.rd-note-box {
  background: var(--rd-chip-bg);
  color: var(--rd-muted-strong);
}
.rd-group-head {
  color: var(--rd-muted);
  background: var(--rd-chip-bg);
}
.rd-input {
  width: 100%;
  border: 1px solid var(--rd-border);
  background: var(--rd-chip-bg);
  color: var(--rd-fg);
  border-radius: 8px;
  transition: border-color 0.15s ease;
}
.rd-input:focus {
  outline: none;
  border-color: var(--rd-accent);
}
.rd-mark {
  background: rgba(250, 204, 21, 0.55);
  color: inherit;
  padding: 0 1px;
}
.book-reader.theme-dark .rd-mark {
  background: rgba(250, 204, 21, 0.3);
  color: #fde68a;
}
.book-reader.theme-sepia .rd-mark {
  background: rgba(156, 124, 71, 0.3);
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
  padding: 5px 0;
  font-size: 13px;
  color: var(--rd-muted-strong);
  text-decoration: none;
  cursor: pointer;
  line-height: 1.6;
  border-radius: 6px;
  transition: color 0.15s ease;
}

.toc-tree a:hover {
  color: var(--rd-fg);
}

.toc-tree a[aria-current] {
  font-weight: 700;
  color: var(--rd-fg);
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
.slide-left-leave-active {
  transition:
    transform 0.25s ease,
    opacity 0.25s ease;
}

.slide-left-enter-from,
.slide-left-leave-to {
  transform: translateX(-100%);
  opacity: 0;
}

.slide-right-enter-active,
.slide-right-leave-active {
  transition:
    transform 0.25s ease,
    opacity 0.25s ease;
}

.slide-right-enter-from,
.slide-right-leave-to {
  transform: translateX(100%);
  opacity: 0;
}

/* 顶/底栏滑入动画（覆盖阅读区，不参与布局） */
.slide-down-enter-active,
.slide-down-leave-active,
.slide-up-enter-active,
.slide-up-leave-active {
  transition:
    transform 0.25s ease,
    opacity 0.25s ease;
}

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
