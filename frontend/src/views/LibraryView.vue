<template>
  <!-- 书架内禁用浏览器右键菜单，交给自定义菜单处理 -->
  <main class="library-page" @contextmenu.prevent>
    <div class="library-page__inner">
      <header class="library-head">
        <h1>书架</h1>
        <span
          v-if="syncStatus.connection !== 'connected'"
          role="status"
          class="library-head__sync"
          data-testid="library-sync-status"
        ><i aria-hidden="true" />{{ syncStatus.error ?? '正在连接书库更新…' }}</span>
        <span class="library-head__grow" />
        <UiButton data-testid="library-refresh" variant="ghost" size="sm" icon="refresh" @click="loadLibrary({}, { force: true })">刷新书架</UiButton>
      </header>

      <p v-if="error" role="alert" class="library-error">{{ error }}</p>

      <LibraryToolbar
        :view-mode="viewMode"
        :total-count="pagination.total"
        :selecting="selecting"
        v-model:searchQuery="searchQuery"
        :selected-formats="selectedFormats"
        @update:selected-formats="selectedFormats = $event"
        @change-view="changeView"
        @toggle-selecting="toggleSelecting"
        @manual-add="isAddingBook = true"
        @import="openImportModal"
      />


      <!-- 有 AI 预分析结果时分两栏：左边封面墙/列表，右边结果面板（设计稿“书架 · 批量选择”）；窄屏面板在上 -->
      <div class="library-body" :class="{ 'library-body--panel': showAnalysisPanel }">
      <div class="library-body__main">
      <!-- 加载：封面形状的骨架 -->
      <div v-if="loading" class="library-wall" role="status" aria-label="正在加载书架">
        <div v-for="n in 10" :key="n" class="library-skeleton" aria-hidden="true"><i /><i /><i /></div>
      </div>

      <!-- 空书架 / 筛选无结果 -->
      <div v-else-if="filteredBooks.length === 0" class="library-empty">
        <div class="library-empty__ghosts" aria-hidden="true"><i /><i /><i /></div>
        <template v-if="hasFilters">
          <h2>没有符合条件的书</h2>
          <p>换个关键词，或者清除格式筛选。</p>
          <UiButton size="sm" @click="clearFilters">清除筛选</UiButton>
        </template>
        <template v-else>
          <h2>书架还是空的</h2>
          <p>到“采集”页找书，或者直接导入本地的电子书文件。</p>
          <div class="library-empty__actions">
            <UiButton variant="primary" size="sm" icon="upload" @click="openImportModal">导入电子书</UiButton>
            <UiButton size="sm" icon="plus" @click="isAddingBook = true">手动添加</UiButton>
          </div>
        </template>
      </div>

      <!-- 视图 1：封面墙 -->
      <div v-else-if="viewMode === 'grid'" class="library-wall" :class="{ 'library-wall--selecting': selecting }">
        <button type="button" class="library-import-tile" @click="openImportModal">
          <UiIcon name="plus" :size="26" />
          <span>导入电子书</span>
        </button>
        <LibraryBookTile
          v-for="book in filteredBooks"
          :key="book.id"
          :book="book"
          :selecting="selecting"
          :selected="isBookSelected(book.id)"
          @open="openReadModal(book)"
          @toggle="toggleSelect(book.id)"
          @menu="onRightClick($event, book)"
        />
      </div>

      <!-- 视图 2：列表（天然可多选） -->
      <div v-else class="library-list">
        <label class="library-list__head">
          <input type="checkbox" :checked="isAllSelected" @change="handleSelectAll" />
          <span>全选本页</span>
        </label>
        <div
          v-for="book in filteredBooks"
          :key="book.id"
          :data-library-book="book.id"
          class="library-row"
          :class="{ 'library-row--selected': isBookSelected(book.id) }"
          @contextmenu.stop.prevent="onRightClick($event, book)"
        >
          <input
            type="checkbox"
            :checked="isBookSelected(book.id)"
            :aria-label="`选择《${book.title}》`"
            @change="toggleSelect(book.id)"
          />
          <div class="library-row__cover"><BookCover :title="book.title" :cover-url="book.coverUrl" /></div>
          <div class="library-row__main">
            <button type="button" class="library-row__title" @click="openReadModal(book)">{{ book.title }}</button>
            <span class="library-row__authors">{{ book.authors.join(', ') || '未知作者' }}</span>
          </div>
          <div class="library-row__meta">
            <BookAnalysisStatus
              v-if="book.bookAnalysis && book.bookAnalysis.status !== 'unsupported'"
              :status="book.bookAnalysis.status"
            />
            <span class="library-row__format">{{ getFormatLabel(book) }}</span>
            <UiStatus v-if="!book.isDownloaded && book.downloadStatus === 'downloading'" tone="info">下载中 {{ normalizedDownloadProgress(book) }}%</UiStatus>
            <UiStatus v-else-if="book.downloadStatus === 'failed'" tone="err">下载失败</UiStatus>
            <UiStatus v-else-if="!book.isDownloaded">等待下载</UiStatus>
          </div>
        </div>
      </div>

      </div>

      <aside
        v-if="showAnalysisPanel"
        data-testid="book-analysis-batch-results"
        class="library-analysis"
        aria-labelledby="library-analysis-title"
      >
        <div class="library-analysis__head">
          <h2 id="library-analysis-title">AI 预分析结果</h2>
          <span v-if="isBatchAnalyzing">处理中</span>
          <UiButton v-else variant="ghost" size="sm" icon="close" icon-only label="关闭 AI 预分析结果" @click="dismissBatchResults" />
        </div>
        <p v-if="batchAnalysisError" class="library-analysis__error">{{ batchAnalysisError }}</p>
        <ul v-else>
          <!-- 每本只显示当前状态；跳过和提交失败直接说明结果 -->
          <li v-for="item in batchAnalysisResults" :key="item.bookId">
            <span class="library-analysis__cover"><BookCover :title="item.title" :cover-url="analysisCover(item.bookId)" /></span>
            <span class="library-analysis__title" :title="item.title">{{ item.title }}</span>
            <UiStatus v-if="item.disposition === 'skipped'">已跳过</UiStatus>
            <UiStatus v-else-if="item.disposition === 'rejected'" tone="err">失败</UiStatus>
            <BookAnalysisStatus v-else-if="item.seenStatuses.length" :status="item.seenStatuses[item.seenStatuses.length - 1]" />
          </li>
        </ul>
      </aside>
      </div>

      <Pagination
        v-if="pagination.totalPages > 1"
        :page="pagination.page"
        :total-pages="pagination.totalPages"
        :is-loading="loading"
        aria-label="书架分页"
        @go="goToLibraryPage"
      />

      <LibraryBatchBar
        v-if="viewMode === 'list' || selecting"
        :selected-count="selectedBookIds.length"
        :is-batch-scraping="isBatchScraping"
        :batch-scrape-done="batchScrapeDone"
        :batch-scrape-total="batchScrapeTotal"
        :is-batch-analyzing="isBatchAnalyzing"
        @batch-delete="handleBatchDelete"
        @batch-scrape="handleBatchScrape"
        @batch-analyze="handleBatchAnalyze"
      />
    </div>

    <!-- 交互层 -->
    <ManualAddModal
      :is-open="isAddingBook"
      @close="isAddingBook = false"
      @save="onAddBook"
    />

    <ImportBookModal
      ref="importModalRef"
      :is-open="isImporting"
      :import-items="importItems"
      @close="closeImportModal"
      @import="onImportBook"
    />

    <BookDetailModal
      :is-open="!!readingBook"
      :book="readingBookItem"
      :library-book-id="readingBook?.id"
      :deleted="detailBookDeleted"
      mode="library"
      @close="readingBook = null"
      @read="startReading"
      @analyze="handleDetailAnalyze"
      @profile-updated="handleProfileUpdated"
      @douban-rating-selected="handleDoubanRatingSelected"
      @edit="editFromDetail('edit')"
      @scrape="editFromDetail('scrape')"
    />

    <ContextMenu
      :show="menuState.show"
      :x="menuState.x"
      :y="menuState.y"
      @close="menuState.show = false"
      @action="handleMenuAction"
    />

    <BookEditModal
      :is-open="isEditing"
      :book="targetBook"
      @close="isEditing = false"
      @save="onSaveMetadata"
    />

    <ScraperModal
      :is-open="isScraping"
      :book="targetBook"
      @close="isScraping = false"
      @apply="onApplyScrapedData"
    />

    <BatchMetadataReviewModal
      :is-open="isBatchReviewOpen"
      :books="batchScrapeBooks"
      :provider="batchScrapeProvider"
      @close="closeBatchReview"
      @busy-change="isBatchScraping = $event"
      @progress="handleBatchScrapeProgress"
      @applied="handleBatchMetadataApplied"
    />

    <!-- 删除确认（替代 window.confirm） -->
    <UiOverlay :open="pendingDelete !== null" kind="dialog" labelledby="library-delete-title" @close="pendingDelete = null">
      <div v-if="pendingDelete" class="library-confirm">
        <h2 id="library-delete-title">{{ pendingDelete.heading }}</h2>
        <p>书籍文件、批注和阅读记录会一起删除，无法恢复。</p>
        <div class="library-confirm__actions">
          <UiButton data-autofocus :disabled="deleting" @click="pendingDelete = null">取消</UiButton>
          <UiButton variant="danger" icon="trash" :disabled="deleting" @click="confirmDelete">{{ deleting ? '正在删除…' : '删除' }}</UiButton>
        </div>
      </div>
    </UiOverlay>
  </main>
</template>

<script setup lang="ts">
import { toLibraryDetail } from '../features/book-detail/domain/detail';
import type { BatchImportBookResultItem } from '../features/library/model/library';
import { ref, reactive, computed, onMounted, nextTick, onBeforeUnmount, onUnmounted, watch } from 'vue';
import LibraryToolbar from '../features/library/ui/LibraryToolbar.vue';
import ContextMenu from '../features/library/ui/ContextMenu.vue';
import BookEditModal from '../features/library/ui/BookEditModal.vue';
import ScraperModal from '../features/metadata/ui/ScraperModal.vue';
import BatchMetadataReviewModal from '../features/metadata/ui/BatchMetadataReviewModal.vue';
import ManualAddModal from '../features/library/ui/ManualAddModal.vue';
import ImportBookModal from '../features/library/ui/ImportBookModal.vue';
import BookDetailModal from '../features/book-detail/ui/BookDetailModal.vue';
import BookAnalysisStatus from '../features/metadata/ui/BookAnalysisStatus.vue';
import LibraryBookTile from '../features/library/ui/LibraryBookTile.vue';
import LibraryBatchBar from '../features/library/ui/LibraryBatchBar.vue';
import Pagination from '../shared/ui/Pagination.vue';
import BookCover from '../shared/ui/BookCover.vue';
import UiButton from '../shared/ui/UiButton.vue';
import UiIcon from '../shared/ui/UiIcon.vue';
import UiOverlay from '../shared/ui/UiOverlay.vue';
import UiStatus from '../shared/ui/UiStatus.vue';
import { showToast } from '../shared/web/toast';
import { useLibrary } from '../features/library/web/useLibrary';
import { importBooks } from '../features/library/web/importBooks';
import type { LibraryBook, AddBookManualParams } from '../features/library/model/library';
import type { MetadataProvider, ScrapedResult } from '../features/metadata/model/metadata';
import type { BookDetailModel } from '../features/book-detail/model/bookDetail';
import { useReader } from '../features/reader/web/useReader';
import { useLibraryAnalysis } from '../features/library/web/useLibraryAnalysis';
import { useBookDeletion } from '../features/library/web/librarySession';
import { toAnalysisSummary } from '../features/metadata/domain/analysisSummary';
import { useBookAnalysis } from '../features/metadata/web/useBookAnalysis';
import { genreDisplayLabel, isBookAnalysisActive } from '../features/metadata/domain/analysisState';
import type {
  BookAnalysisDetail,
  BookAnalysisDisposition,
  BookAnalysisStatus as BookAnalysisStatusValue,
  BookAnalysisSummary,
} from '../features/metadata/model/bookAnalysis';
import type { DoubanRatingCandidate } from '../features/metadata/model/metadata';
import type { EbookFormat } from '../shared/utils/bookFormat';

interface ImportModalItem extends BatchImportBookResultItem {
  localId: string;
}

// 从逻辑层获取状态
const {
  books,
  loading,
  error,
  viewMode,
  selectedBookIds,
  pagination,
  setViewMode,
  loadLibrary,
  addBook,
  toggleSelect,
  toggleSelectAll,
  clearSelection,
  deleteBooks,
  updateBookMetadata, browse, invalidate, updateCachedBook, syncStatus
} = useLibrary();

const { openReader } = useReader();

const getFormatLabel = (book: LibraryBook) => {
  return book.format?.toUpperCase() ?? '无格式';
};

const normalizedDownloadProgress = (book: LibraryBook) => {
  const progress = Number(book.downloadProgress ?? 0);
  if (!Number.isFinite(progress)) return 0;
  return Math.min(100, Math.max(0, Math.round(progress)));
};

// 本地搜索过滤逻辑
const searchQuery = ref(browse.query.keyword ?? '');
const selectedFormats = ref<EbookFormat[]>(browse.query.formats ?? []);
const filteredBooks = computed(() => books.value);
const hasFilters = computed(() => searchQuery.value.trim() !== '' || selectedFormats.value.length > 0);
const clearFilters = () => {
  searchQuery.value = '';
  selectedFormats.value = [];
};

// 封面墙的选择模式：进入后点封面是勾选；退出时清空已选。列表视图天然可选。
const selecting = ref(false);
const toggleSelecting = () => {
  selecting.value = !selecting.value;
  if (!selecting.value) clearSelection();
};
const changeView = (mode: typeof viewMode.value) => {
  setViewMode(mode);
  selecting.value = mode === 'grid' && selectedBookIds.value.length > 0;
};
watch(books, (_next,previous) => {
  if(!previous.length)return;
  const elements=Array.from(document.querySelectorAll<HTMLElement>('[data-library-book]'));
  const anchor=elements.find(el=>el.getBoundingClientRect().bottom>0);
  const id=anchor?.dataset.libraryBook, top=anchor?.getBoundingClientRect().top, y=window.scrollY;
  void nextTick(()=>{const restored=id?document.querySelector<HTMLElement>(`[data-library-book="${id}"]`):null;
    window.scrollTo(0,restored && top!==undefined ? window.scrollY+restored.getBoundingClientRect().top-top:y);
  });
}, {flush:'pre'});

let libraryFilterTimer: number | null = null;

watch([searchQuery, selectedFormats], () => {
  if (libraryFilterTimer !== null) window.clearTimeout(libraryFilterTimer);
  libraryFilterTimer = window.setTimeout(() => {
    void loadLibrary({
      page: 1,
      keyword: searchQuery.value.trim() || undefined,
      formats: selectedFormats.value,
    });
  }, 250);
}, { deep: true });

const goToLibraryPage = (page: number) => {
  void loadLibrary({
    page,
    keyword: searchQuery.value.trim() || undefined,
    formats: selectedFormats.value,
  });
};

// 全选状态
const isAllSelected = computed(() => {
  return filteredBooks.value.length > 0 && selectedBookIds.value.length === filteredBooks.value.length;
});

// 弹窗状态管理
const isAddingBook = ref(false); // 手动添加弹窗
const isImporting = ref(false); // 导入电子书弹窗
const importModalRef = ref<InstanceType<typeof ImportBookModal> | null>(null);
const importItems = ref<ImportModalItem[]>([]);
const readingBook = ref<LibraryBook | null>(null); // 详情弹窗 (LibraryBook type)
const readingBookItem = computed(() => readingBook.value ? toLibraryDetail(readingBook.value) : null);
const detailBookId = computed(() => readingBook.value?.id ?? null);
const detailBookDeleted = useBookDeletion(() => detailBookId.value);
const {
  analysis: detailAnalysis,
  refresh: refreshDetailAnalysis,
  analyze: analyzeDetailBook,
} = useBookAnalysis(detailBookId, { immediate: false });
const targetBook = ref<LibraryBook | null>(null);  // 右键操作的目标书
const isEditing = ref(false);  // 编辑状态
const isScraping = ref(false); // 刮削状态
const menuState = reactive({ show: false, x: 0, y: 0 }); // 右键菜单位置

onMounted(async () => { await loadLibrary(); window.scrollTo(0,browse.scrollY); });
onBeforeUnmount(() => { browse.scrollY=window.scrollY; });
onUnmounted(() => { if (libraryFilterTimer !== null) window.clearTimeout(libraryFilterTimer); });

watch(detailBookId, (bookId) => {
  if (bookId) void refreshDetailAnalysis();
});

watch(detailAnalysis, (detail) => {
  if (!detail || readingBook.value?.id !== detail.bookId) return;
  const summary = toAnalysisSummary(detail);
  readingBook.value = { ...readingBook.value, bookAnalysis: summary };
  updateCachedBook(detail.bookId, { bookAnalysis: summary });
});

// 1. 手动添加逻辑
const onAddBook = async (params: AddBookManualParams) => {
  try {
    await addBook(params);
    isAddingBook.value = false;
    showToast(`《${params.title}》已加入书架`, 'ok');
  } catch (e: any) {
    showToast(`添加失败：${e.message}`, 'err');
  }
};

const openImportModal = () => {
  importItems.value = [];
  isImporting.value = true;
};

const closeImportModal = () => {
  isImporting.value = false;
  importItems.value = [];
};

// 1.5 导入电子书逻辑
const onImportBook = async (params: { files: File[]; title?: string; authors?: string; isbn?: string; coverUrl?: string; conflictPolicy?: string }) => {
  try {
    if (params.conflictPolicy !== undefined && !['rename','skip','overwrite'].includes(params.conflictPolicy)) throw new Error('无效导入冲突策略');
    importItems.value = (await importBooks({...params, conflictPolicy:params.conflictPolicy as 'rename'|'skip'|'overwrite'|undefined}, {invalidate})).map(toImportModalItem);
    await loadLibrary();
    importModalRef.value?.setSubmitting(false);
    closeImportModal();
  } catch (e: any) {
    showToast(`导入失败：${e.message || '未知错误'}`, 'err');
    importModalRef.value?.setSubmitting(false);
  }
};

const toImportModalItem = (item: BatchImportBookResultItem): ImportModalItem => ({
  ...item,
  localId: `${item.index}:${item.book?.id ?? item.originalFileName}`,
});

const isBookSelected = (bookId: number) => selectedBookIds.value.includes(bookId);

const isBatchScraping = ref(false);
const batchScrapeDone = ref(0);
const batchScrapeTotal = ref(0);
const isBatchReviewOpen = ref(false);
const batchScrapeBooks = ref<LibraryBook[]>([]);
const batchScrapeProvider = ref<MetadataProvider>('zlibrary');

const { isBatchAnalyzing, batchAnalysisResults, batchAnalysisError, handleBatchAnalyze, dismissBatchResults } = useLibraryAnalysis(books, selectedBookIds);
const showAnalysisPanel = computed(() => batchAnalysisResults.value.length > 0 || !!batchAnalysisError.value);
const analysisCover = (bookId: number) => books.value.find(book => book.id === bookId)?.coverUrl ?? null;

const handleBatchScrape = (provider: MetadataProvider = 'zlibrary') => {
  if (isBatchScraping.value) return;
  const selectedBooks = filteredBooks.value.filter((book) => selectedBookIds.value.includes(book.id));
  if (selectedBooks.length === 0) {
    showToast('先选择要刮削的书。');
    return;
  }

  batchScrapeBooks.value = selectedBooks;
  batchScrapeProvider.value = provider;
  batchScrapeDone.value = 0;
  batchScrapeTotal.value = selectedBooks.length;
  isBatchReviewOpen.value = true;
};

const closeBatchReview = () => {
  isBatchReviewOpen.value = false;
  batchScrapeBooks.value = [];
};

const handleBatchScrapeProgress = (done: number, total: number) => {
  batchScrapeDone.value = done;
  batchScrapeTotal.value = total;
};

const handleBatchMetadataApplied = async () => {
  await loadLibrary({}, { preserveSelection: true });
};

// 2. 全选逻辑
const handleSelectAll = () => {
  toggleSelectAll(filteredBooks.value.map(b => b.id));
};

// 3. 左键交互：打开只读详情
const openReadModal = (book: LibraryBook) => {
  readingBook.value = book;
};

const handleDetailAnalyze = async (payload: { bookId: number; force: boolean }) => {
  if (readingBook.value?.id !== payload.bookId) return;
  await analyzeDetailBook({ force: payload.force });
};

const handleProfileUpdated = (profile: LibraryBook['readingProfile']) => {
  if (!readingBook.value || !profile) return;
  readingBook.value = { ...readingBook.value, readingProfile: profile };
  updateCachedBook(readingBook.value.id, { readingProfile: profile });
};

const handleDoubanRatingSelected = (_bookKey: string, rating: DoubanRatingCandidate) => {
  if (!readingBook.value) return;
  const savedRating: LibraryBook['doubanRating'] = {
    sourcePlatform: 'douban',
    sourceBookId: rating.sourceBookId,
    sourceUrl: rating.sourceUrl,
    title: rating.title,
    rating: rating.rating,
    ratingCount: rating.ratingCount,
    fetchedAt: rating.fetchedAt ?? new Date().toISOString(),
  };
  const bookId = readingBook.value.id;
  readingBook.value = { ...readingBook.value, doubanRating: savedRating };
  updateCachedBook(bookId, {doubanRating:savedRating});
};

// 4. 封面按钮交互：直接开始阅读
const startReading = (book: BookDetailModel | LibraryBook) => {
  const libBook = readingBook.value;
  if (!libBook) return;
  if (!libBook.isDownloaded || !libBook.fileUrl) {
    showToast('这本书还没下载完成，暂时无法阅读。');
    return;
  }
  openReader({
    id: libBook.id,
    userId: libBook.userId,
    title: libBook.title,
    authors: libBook.authors,
    coverUrl: libBook.coverUrl,
    fileName: libBook.fileName ?? null,
    fileUrl: libBook.fileUrl,
    isDownloaded: libBook.isDownloaded,
    mimeType: libBook.mimeType ?? null,
    checksum: libBook.checksum ?? null,
    fileSize: libBook.fileSize ?? null,
    updatedAt: libBook.updatedAt,
    version: libBook.version,
  });
};

// 5. 右键交互逻辑
const onRightClick = (e: MouseEvent, book: LibraryBook) => {
  targetBook.value = { ...book }; // 拷贝一份防止直接修改
  menuState.x = Math.min(e.clientX, window.innerWidth - 210);
  menuState.y = Math.min(e.clientY, window.innerHeight - 190);
  menuState.show = true;
};

const handleMenuAction = async (action: string) => {
  if (action === 'edit') isEditing.value = true;
  if (action === 'scrape') isScraping.value = true;
  if (action === 'delete' && targetBook.value) {
    pendingDelete.value = { ids: [targetBook.value.id], heading: `删除《${targetBook.value.title}》？` };
  }
};

// 详情里的“编辑信息 / 刮削元数据”：和右键菜单走同一套弹窗，弹窗叠在详情之上
const editFromDetail = (action: 'edit' | 'scrape') => {
  if (!readingBook.value) return;
  targetBook.value = { ...readingBook.value };
  if (action === 'edit') isEditing.value = true;
  else isScraping.value = true;
};

// 6. 刮削回填逻辑 (PRD 核心逻辑)
const onApplyScrapedData = (scrapedData: ScrapedResult) => {
  if (!targetBook.value) return;
  // 将刮削到的元数据注入到当前编辑目标中
  targetBook.value = { 
    ...targetBook.value, 
    title: scrapedData.title,
    authors: scrapedData.authors,
    isbn: scrapedData.isbn,
    language: scrapedData.language,
    description: scrapedData.description,
    publisher: scrapedData.publisher,
    publishYear: scrapedData.publishYear,
    coverUrl: scrapedData.coverUrl // 如果刮削到了更高清的封面
  };
  // 按照 PRD 要求：刮削完自动打开编辑界面让用户确认
  isEditing.value = true; 
};

// 7. 保存元数据到书架
const onSaveMetadata = async (updatedData: LibraryBook) => {
  try {
    const saved = await updateBookMetadata(updatedData.id, updatedData);
    isEditing.value = false;
    // 书架列表要等失效后的重新查询才更新：先用服务端返回的书刷新缓存里的这本和打开中的详情，
    // 否则详情会一直显示旧书名/简介，直到重新打开
    updateCachedBook(saved.id, saved);
    if (readingBook.value?.id === saved.id) readingBook.value = { ...readingBook.value, ...saved };
    showToast('书籍信息已更新', 'ok');
  } catch (e: any) {
    showToast(`更新失败：${e.message}`, 'err');
  }
};

// 删除统一走页面内确认框（单本来自右键菜单，多本来自批量操作条）
const pendingDelete = ref<{ ids: number[]; heading: string } | null>(null);
const deleting = ref(false);
const handleBatchDelete = () => {
  if (selectedBookIds.value.length === 0) return;
  pendingDelete.value = { ids: [...selectedBookIds.value], heading: `删除选中的 ${selectedBookIds.value.length} 本书？` };
};
const confirmDelete = async () => {
  const target = pendingDelete.value;
  if (!target || deleting.value) return;
  deleting.value = true;
  try {
    await deleteBooks(target.ids);
    showToast(target.ids.length > 1 ? `已删除 ${target.ids.length} 本书` : '已删除', 'ok');
    pendingDelete.value = null;
  } catch (e: any) {
    showToast(`删除失败：${e.message}`, 'err');
  } finally {
    deleting.value = false;
  }
};
</script>

<style scoped>
.library-page {
  min-height: 100vh;
  padding: 28px clamp(16px, 3vw, 32px) 48px;
  background: var(--ui-bg);
  color: var(--ui-fg);
}
.library-page__inner { max-width: 1240px; margin: 0 auto; }

.library-head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; margin-bottom: 18px; }
.library-head h1 { margin: 0; font-size: 26px; font-weight: 900; letter-spacing: -0.01em; }
.library-head__grow { flex: 1; }
.library-head__sync {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  border: 1px solid var(--ui-line);
  border-radius: 999px;
  background: var(--ui-surface);
  color: var(--ui-muted);
  font-size: 12px;
}
.library-head__sync i { width: 8px; height: 8px; border-radius: 50%; background: var(--ui-warn); animation: library-pulse 1.4s infinite; }
@keyframes library-pulse { 50% { opacity: 0.3; } }
.library-error { margin: 0 0 14px; padding: 10px 14px; border-radius: 12px; background: color-mix(in srgb, var(--ui-err) 10%, var(--ui-surface)); color: var(--ui-err); font-size: 13px; }

.library-body--panel { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 18px; align-items: start; }
.library-body__main { min-width: 0; }
.library-analysis { position: sticky; top: calc(var(--app-header-h, 64px) + 12px); padding: 14px 16px; border: 1px solid var(--ui-line); border-radius: var(--ui-radius-card); background: var(--ui-surface); }
.library-analysis__head { display: flex; justify-content: space-between; align-items: center; gap: 10px; min-height: 28px; margin-bottom: 10px; }
.library-analysis__head h2 { margin: 0; font-size: 15px; font-weight: 900; }
.library-analysis__head span { font-size: 12px; color: var(--ui-muted); }
.library-analysis__error { margin: 0; font-size: 13px; color: var(--ui-err); }
.library-analysis ul { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.library-analysis li { display: grid; grid-template-columns: 26px minmax(0, 1fr) auto; align-items: center; gap: 10px; font-size: 13px; }
.library-analysis__cover :deep(.book-cover) { border-radius: 3px; }
.library-analysis__title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 900px) {
  .library-body--panel { grid-template-columns: minmax(0, 1fr); }
  .library-analysis { position: static; order: -1; }
}

.library-wall {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 28px 18px;
}
@media (max-width: 640px) {
  .library-wall { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px 10px; }
}
.library-import-tile {
  aspect-ratio: 3 / 4;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 8px;
  border: 1.5px dashed color-mix(in srgb, var(--ui-fg) 28%, transparent);
  border-radius: var(--ui-radius-cover);
  background: transparent;
  color: var(--ui-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.library-import-tile:hover { border-color: var(--ui-fg); color: var(--ui-fg); }
.library-import-tile:focus-visible { outline: 2px solid var(--ui-fg); outline-offset: 3px; }
.library-wall--selecting .library-import-tile { opacity: 0.4; pointer-events: none; }

.library-skeleton { display: grid; gap: 7px; }
.library-skeleton i { display: block; border-radius: var(--ui-radius-cover); background: linear-gradient(90deg, var(--ui-surface2) 30%, color-mix(in srgb, var(--ui-surface2) 60%, var(--ui-fg) 8%) 50%, var(--ui-surface2) 70%) 0 0 / 300% 100%; animation: library-shimmer 1.6s infinite linear; }
.library-skeleton i:first-child { aspect-ratio: 3 / 4; }
.library-skeleton i:nth-child(2) { height: 11px; width: 80%; }
.library-skeleton i:nth-child(3) { height: 9px; width: 50%; }
@keyframes library-shimmer { to { background-position: -150% 0; } }
@media (prefers-reduced-motion: reduce) { .library-skeleton i, .library-head__sync i { animation: none; } }

.library-empty { display: grid; justify-items: center; gap: 10px; padding: 64px 16px; text-align: center; }
.library-empty h2 { margin: 6px 0 0; font-size: 18px; font-weight: 900; }
.library-empty p { margin: 0; max-width: 32ch; font-size: 14px; color: var(--ui-muted); }
.library-empty__actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 4px; }
.library-empty__ghosts { display: flex; align-items: flex-end; gap: 6px; height: 88px; }
.library-empty__ghosts i { width: 46px; border-radius: 5px; border: 1.5px dashed color-mix(in srgb, var(--ui-fg) 28%, transparent); }
.library-empty__ghosts i:nth-child(1) { height: 62px; transform: rotate(-6deg); }
.library-empty__ghosts i:nth-child(2) { height: 80px; }
.library-empty__ghosts i:nth-child(3) { height: 70px; transform: rotate(5deg); }

.library-list { border: 1px solid var(--ui-line); border-radius: var(--ui-radius-card); background: var(--ui-surface); overflow: hidden; }
.library-list input[type="checkbox"] { width: 16px; height: 16px; flex: none; accent-color: var(--ui-strong); cursor: pointer; }
.library-list__head { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--ui-line); background: var(--ui-bg2); font-size: 12px; color: var(--ui-muted); cursor: pointer; }
.library-row { display: grid; grid-template-columns: auto 34px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--ui-line); }
.library-row:last-child { border-bottom: 0; }
.library-row:hover, .library-row--selected { background: color-mix(in srgb, var(--ui-fg) 4%, transparent); }
.library-row__cover :deep(.book-cover) { border-radius: 3px; }
.library-row__main { display: grid; gap: 2px; min-width: 0; }
.library-row__title { justify-self: start; max-width: 100%; padding: 0; border: 0; background: none; color: var(--ui-fg); font: inherit; font-size: 14px; font-weight: 700; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.library-row__title:hover { text-decoration: underline; text-underline-offset: 3px; }
.library-row__title:focus-visible { outline: 2px solid var(--ui-fg); outline-offset: 2px; }
.library-row__authors { font-size: 12px; color: var(--ui-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.library-row__meta { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 8px; }
.library-row__format { font-size: 11px; font-weight: 700; color: var(--ui-muted); letter-spacing: 0.04em; }
@media (max-width: 640px) {
  .library-row { grid-template-columns: auto 30px minmax(0, 1fr); padding: 10px 12px; }
  .library-row__meta { grid-column: 3; justify-content: flex-start; }
}

.library-confirm { display: grid; gap: 10px; padding: 22px; }
.library-confirm h2 { margin: 0; font-size: 17px; font-weight: 900; }
.library-confirm p { margin: 0; font-size: 14px; color: var(--ui-fg2); }
.library-confirm__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
</style>
