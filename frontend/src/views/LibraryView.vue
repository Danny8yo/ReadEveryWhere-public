<template>
  <!-- 全局禁用右键菜单，交给自定义组件处理 -->
  <main class="min-h-screen bg-white text-black px-4 md:px-8 py-16 md:py-20 pb-40" @contextmenu.prevent>
    <div class="max-w-7xl mx-auto">
      
      <!-- 页面标题 -->
      <div class="mb-16 space-y-4">
        <span class="text-[10px] uppercase tracking-[0.4em] font-bold text-gray-400">私人档案</span>
        <h1 class="text-4xl md:text-6xl font-serif italic tracking-tighter">书架.</h1>
      </div>

      <!-- 工具栏 -->
      <p v-if="error" role="alert" class="mb-4 text-sm text-red-600">{{ error }}</p>
      <p v-if="syncStatus.connection !== 'connected'" role="status" class="text-sm text-gray-500" data-testid="library-sync-status">{{ syncStatus.error ?? '正在连接书库更新…' }}</p>
      <button data-testid="library-refresh" class="mb-4 underline text-sm" @click="loadLibrary({}, {force:true})">刷新书架</button>
    <LibraryToolbar
        :view-mode="viewMode"
        :total-count="pagination.total"
        :selected-count="selectedBookIds.length"
        :is-batch-scraping="isBatchScraping"
        :batch-scrape-done="batchScrapeDone"
        :batch-scrape-total="batchScrapeTotal"
        :is-batch-analyzing="isBatchAnalyzing"
        v-model:searchQuery="searchQuery"
        :selected-formats="selectedFormats"
        @update:selected-formats="selectedFormats = $event"
        @change-view="setViewMode"
        @batch-delete="handleBatchDelete"
        @batch-scrape="handleBatchScrape"
        @batch-analyze="handleBatchAnalyze"
      />

      <section
        v-if="batchAnalysisResults.length > 0 || batchAnalysisError"
        data-testid="book-analysis-batch-results"
        class="mb-8 border-y border-gray-100 py-4"
      >
        <div class="flex items-center justify-between gap-4 mb-3">
          <h2 class="text-[10px] font-bold uppercase tracking-widest text-gray-500">AI 预分析结果</h2>
          <span v-if="isBatchAnalyzing" class="text-[10px] text-gray-400">处理中</span>
        </div>
        <p v-if="batchAnalysisError" class="text-xs text-red-600">{{ batchAnalysisError }}</p>
        <ul v-else class="grid gap-2">
          <li v-for="item in batchAnalysisResults" :key="item.bookId" class="flex flex-wrap items-center gap-2 text-xs">
            <span class="min-w-0 flex-1 truncate text-gray-700">{{ item.title }}</span>
            <span v-if="item.disposition === 'skipped'" class="text-gray-500">已跳过</span>
            <span v-else-if="item.disposition === 'rejected'" class="text-red-600">失败</span>
            <BookAnalysisStatus
              v-for="status in item.seenStatuses"
              :key="status"
              :status="status"
            />
          </li>
        </ul>
      </section>

      <div v-if="loading" class="text-center py-20 text-gray-400 font-serif italic">
        正在加载书架...
      </div>
      
      <div v-else-if="filteredBooks.length === 0 && viewMode === 'list'" class="text-center py-20 text-gray-400 font-serif italic">
        书架空空如也，去“采集”一些书吧。
      </div>

      <!-- 视图 1: 封面墙 (Grid) -->
      <div v-else-if="viewMode === 'grid'" class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-x-4 md:gap-x-8 gap-y-8 md:gap-y-16">
        <!-- 手动添加入口 -->
        <div
          class="relative group cursor-pointer"
          @click="isAddingBook = true"
        >
          <div class="aspect-[3/4] overflow-hidden bg-gray-50 rounded-sm relative shadow-sm flex flex-col items-center justify-center border-2 border-dashed border-gray-200 hover:border-black transition-colors group">
            <span class="text-4xl text-gray-300 group-hover:text-black transition-colors">+</span>
            <span class="mt-4 text-[10px] font-bold uppercase tracking-widest text-gray-400 group-hover:text-black transition-colors">添加书籍</span>
          </div>
        </div>

        <!-- 导入电子书入口 -->
        <div
          class="relative group cursor-pointer"
          @click="openImportModal"
        >
          <div class="aspect-[3/4] overflow-hidden bg-gray-50 rounded-sm relative shadow-sm flex flex-col items-center justify-center border-2 border-dashed border-gray-200 hover:border-black transition-colors group">
            <span class="text-4xl text-gray-300 group-hover:text-black transition-colors">&#8627;</span>
            <span class="mt-4 text-[10px] font-bold uppercase tracking-widest text-gray-400 group-hover:text-black transition-colors">导入电子书</span>
          </div>
        </div>

        <div 
          v-for="book in filteredBooks" 
          :key="book.id" :data-library-book="book.id"
          class="relative group"
          :class="isBookSelected(book.id) ? 'selected-book-card' : ''"
          @contextmenu.stop.prevent="onRightClick($event, book)"
        >
          <!-- 选择勾选框 -->
          <div
            class="absolute top-2 left-2 z-30 transition-opacity"
            :class="isBookSelected(book.id) ? 'opacity-100' : 'opacity-100 md:opacity-0 md:group-hover:opacity-100'"
          >
            <input 
              type="checkbox" 
              :checked="selectedBookIds.includes(book.id)"
              @click.stop
              @change="toggleSelect(book.id)"
              class="w-5 h-5 accent-black cursor-pointer shadow-sm"
            />
          </div>

          <!-- 封面容器 -->
          <div
            class="aspect-[3/4] overflow-hidden bg-gray-50 rounded-sm relative shadow-sm cursor-pointer group transition-all duration-200"
            :class="isBookSelected(book.id) ? 'ring-4 ring-black ring-offset-4 ring-offset-white shadow-xl' : ''"
          >
            <span class="absolute top-3 right-3 z-20 bg-black/80 text-white text-[9px] font-bold uppercase tracking-widest px-2 py-1">
              {{ getFormatLabel(book) }}
            </span>
            <div
              v-if="isBookSelected(book.id)"
              class="absolute inset-0 z-10 border-4 border-black bg-black/10 pointer-events-none"
            />
            <img
              :src="book.coverUrl || ''"
              class="w-full h-full object-cover grayscale-[0.2] hover:grayscale-0 transition-all duration-700 group-hover:scale-105"
              @click="openReadModal(book)"
            />
            <div
              v-if="isDownloadPending(book)"
              class="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/78 backdrop-blur-[1px] px-5 text-center"
              @click="openReadModal(book)"
            >
              <span class="text-[10px] font-bold uppercase tracking-[0.28em] text-gray-500">
                {{ getDownloadOverlayLabel(book) }}
              </span>
              <span class="mt-2 font-serif text-3xl italic tracking-tighter text-black">
                {{ normalizedDownloadProgress(book) }}%
              </span>
              <div class="mt-4 h-1 w-full overflow-hidden rounded-full bg-gray-200">
                <div
                  class="h-full bg-black transition-all duration-500"
                  :style="{ width: `${normalizedDownloadProgress(book)}%` }"
                />
              </div>
            </div>
            <div v-if="book.downloadStatus === 'failed'"
              class="absolute inset-0 z-10 flex items-center justify-center bg-white/70 text-[10px] text-red-500 font-bold uppercase tracking-widest">
              下载失败
            </div>
            <BookAnalysisStatus
              v-if="book.bookAnalysis && book.bookAnalysis.status !== 'unsupported'"
              class="absolute bottom-3 left-3 z-20"
              :status="book.bookAnalysis.status"
            />
          </div>

          <!-- 底部元数据 -->
          <div class="mt-4 space-y-1" @click="openReadModal(book)">
            <p class="text-[9px] uppercase tracking-widest text-gray-400 font-bold line-clamp-1">{{ book.authors.join(', ') }}</p>
            <h3 class="text-sm font-serif leading-tight group-hover:text-gray-500 transition-colors">{{ book.title }}</h3>
          </div>
        </div>
      </div>

      <!-- 视图 2: 列表页 (List) -->
      <div v-else class="space-y-1">
        <!-- 列表表头：全选 -->
        <div class="flex items-center justify-between border-b-2 border-black pb-4 mb-4 px-4">
          <div class="flex items-center gap-6">
            <input 
              type="checkbox" 
              :checked="isAllSelected"
              @change="handleSelectAll"
              class="w-4 h-4 accent-black"
            />
            <span class="text-[10px] font-bold uppercase tracking-widest text-gray-400">全选本页</span>
          </div>
          <div class="text-[10px] font-bold uppercase tracking-widest text-gray-400 mr-8">
            详细信息与操作
          </div>
        </div>

        <div 
          v-for="book in filteredBooks" 
          :key="book.id" :data-library-book="book.id"
          class="flex items-center justify-between border-b border-gray-50 py-4 hover:bg-gray-50/50 px-4 transition-colors group"
          @contextmenu.stop.prevent="onRightClick($event, book)"
        >
          <div class="flex items-center gap-6">
            <input 
              type="checkbox" 
              :checked="selectedBookIds.includes(book.id)"
              @change="toggleSelect(book.id)"
              class="w-4 h-4 accent-black"
            />
            <div class="flex flex-col">
              <span class="font-serif text-base cursor-pointer hover:underline" @click="openReadModal(book)">{{ book.title }}</span>
              <span class="text-[10px] text-gray-400 uppercase tracking-widest">{{ book.authors.join(', ') }}</span>
            </div>
          </div>
          <div class="flex gap-3 md:gap-12 items-center text-[10px] font-bold uppercase tracking-widest text-gray-400">
            <BookAnalysisStatus
              v-if="book.bookAnalysis && book.bookAnalysis.status !== 'unsupported'"
              :status="book.bookAnalysis.status"
            />
            <span>{{ getFormatLabel(book) }}</span>
            <span v-if="!book.isDownloaded && book.downloadStatus === 'downloading'" class="text-black">
              下载中 {{ book.downloadProgress || 0 }}%
            </span>
            <span v-else-if="book.downloadStatus === 'failed'" class="text-red-500">下载失败</span>
            <span v-else-if="!book.isDownloaded" class="text-gray-300">等待下载</span>
          </div>
        </div>
      </div>

      <Pagination
        v-if="pagination.totalPages > 1"
        :page="pagination.page"
        :total-pages="pagination.totalPages"
        :is-loading="loading"
        aria-label="书架分页"
        @go="goToLibraryPage"
      />
    </div>

    <!-- 交互层 (Modals) -->

    <!-- 手动添加书籍弹窗 -->
    <ManualAddModal
      :is-open="isAddingBook"
      @close="isAddingBook = false"
      @save="onAddBook"
    />

    <!-- 导入电子书弹窗 -->
    <ImportBookModal
      ref="importModalRef"
      :is-open="isImporting"
      :import-items="importItems"
      @close="closeImportModal"
      @import="onImportBook"
    />

    <!-- 详情弹窗 -->
    <BookDetailModal 
      :is-open="!!readingBook"
      :book="readingBookItem"
      :library-book-id="readingBook?.id"
      mode="library" 
      @close="readingBook = null"
      @read="startReading"
      @analyze="handleDetailAnalyze"
      @profile-updated="handleProfileUpdated"
      @douban-rating-selected="handleDoubanRatingSelected"
    />

    <!-- 右键自定义菜单 -->
    <ContextMenu 
      :show="menuState.show" 
      :x="menuState.x" 
      :y="menuState.y" 
      @close="menuState.show = false"
      @action="handleMenuAction"
    />

    <!-- 编辑信息弹窗 -->
    <BookEditModal 
      :is-open="isEditing"
      :book="targetBook"
      @close="isEditing = false"
      @save="onSaveMetadata"
    />

    <!-- 智能刮削弹窗 -->
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
  </main>
</template>

<script setup lang="ts">
import { toLibraryDetail } from '../features/library/domain/detail';
import type { BatchImportBookResultItem } from '../features/library/model/library';
import { ref, reactive, computed, onMounted, nextTick, onBeforeUnmount, onUnmounted, watch } from 'vue';
import LibraryToolbar from '../components/library/LibraryToolbar.vue';
import ContextMenu from '../components/library/ContextMenu.vue';
import BookEditModal from '../components/library/BookEditModal.vue';
import ScraperModal from '../components/library/ScraperModal.vue';
import BatchMetadataReviewModal from '../components/library/BatchMetadataReviewModal.vue';
import ManualAddModal from '../components/library/ManualAddModal.vue';
import ImportBookModal from '../components/library/ImportBookModal.vue';
import BookDetailModal from '../components/BookDetailModal.vue';
import BookAnalysisStatus from '../components/book-analysis/BookAnalysisStatus.vue';
import Pagination from '../components/Pagination.vue';
import { useLibrary } from '../composables/useLibrary';
import { importBooks } from '../features/library/web/importBooks';
import type { LibraryBook, AddBookManualParams } from '../features/library/model/library';
import type { MetadataProvider, ScrapedResult } from '../features/metadata/model/metadata';
import type { BookDetailModel } from '../shared/model/bookDetail';
import { useReader } from '../composables/useReader';
import { useLibraryAnalysis } from '../features/library/web/useLibraryAnalysis';
import { toAnalysisSummary } from '../features/metadata/domain/analysisSummary';
import { useBookAnalysis } from '../composables/useBookAnalysis';
import { genreDisplayLabel, isBookAnalysisActive } from '../features/metadata/domain/analysisState';
import type {
  BookAnalysisDetail,
  BookAnalysisDisposition,
  BookAnalysisStatus as BookAnalysisStatusValue,
  BookAnalysisSummary,
} from '../features/metadata/model/bookAnalysis';
import type { DoubanRatingCandidate } from '../features/metadata/model/metadata';
import type { EbookFormat } from '../utils/bookFormat';

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
  deleteBooks,
  updateBookMetadata, browse, invalidate, updateCachedBook, syncStatus
} = useLibrary();

const { openReader } = useReader();

const getFormatLabel = (book: LibraryBook) => {
  return book.format?.toUpperCase() ?? '无格式';
};

const activeDownloadStatuses = new Set(['queued', 'downloading']);

const normalizedDownloadProgress = (book: LibraryBook) => {
  const progress = Number(book.downloadProgress ?? 0);
  if (!Number.isFinite(progress)) return 0;
  return Math.min(100, Math.max(0, Math.round(progress)));
};

const isDownloadPending = (book: LibraryBook) => {
  return !book.isDownloaded && activeDownloadStatuses.has(book.downloadStatus ?? '');
};

const getDownloadOverlayLabel = (book: LibraryBook) => {
  return book.downloadStatus === 'queued' ? '等待下载' : '下载中';
};

// 本地搜索过滤逻辑
const searchQuery = ref(browse.query.keyword ?? '');
const selectedFormats = ref<EbookFormat[]>(browse.query.formats ?? []);
const filteredBooks = computed(() => books.value);
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
    alert(`书籍《${params.title}》已成功添加到书架`);
  } catch (e: any) {
    alert(`添加失败：${e.message}`);
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
    alert(`导入失败：${e.message || '未知错误'}`);
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

const { isBatchAnalyzing, batchAnalysisResults, batchAnalysisError, handleBatchAnalyze } = useLibraryAnalysis(books, selectedBookIds);

const handleBatchScrape = (provider: MetadataProvider = 'zlibrary') => {
  if (isBatchScraping.value) return;
  const selectedBooks = filteredBooks.value.filter((book) => selectedBookIds.value.includes(book.id));
  if (selectedBooks.length === 0) {
    alert('请先在封面墙或列表中选择要刮削的书籍。');
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
    alert('该书籍尚未下载完成，暂无法阅读。');
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
  if (action === 'delete') {
    if (targetBook.value && confirm(`⚠️ 永久删除确认\n确定要从您的私有书库中永久移除《${targetBook.value.title}》吗？`)) {
      try {
        await deleteBooks([targetBook.value.id]);
        alert('已成功删除书籍');
      } catch (e: any) {
        alert(`删除失败：${e.message}`);
      }
    }
  }
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
    await updateBookMetadata(updatedData.id, updatedData);
    isEditing.value = false;
    alert('书籍信息已成功更新');
  } catch (e: any) {
    alert(`更新失败：${e.message}`);
  }
};

const handleBatchDelete = async () => {
  if (confirm(`确定要批量删除选中的 ${selectedBookIds.value.length} 本书籍吗？`)) {
    try {
      await deleteBooks(selectedBookIds.value);
      alert('批量删除成功');
    } catch (e: any) {
      alert(`批量删除失败：${e.message}`);
    }
  }
};
</script>

<style scoped>
/* 针对列表淡入的微动画 */
.animate-fade-in {
  animation: fadeIn 0.3s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(5px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
