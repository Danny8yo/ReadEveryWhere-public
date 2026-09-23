import type { AddBookManualParams, LibraryBook } from "../model/library";
import type { ViewMode } from "../../../types/library";
import type { EbookFormat } from "../../../utils/bookFormat";
export type LoadLibraryParams = {
  page?: number;
  pageSize?: number;
  keyword?: string;
  primaryGenre?: import("../../metadata/model/bookAnalysis").BookReadingGenre;
  secondaryGenre?: import("../../metadata/model/bookAnalysis").BookReadingGenre;
  formats?: EbookFormat[];
};
export type LoadLibraryOptions = {
  silent?: boolean;
  preserveSelection?: boolean;
  force?: boolean;
};
import type { LibraryListResponse } from "../model/library";
export interface ImportRequest<T> {
  file: T;
  title?: string;
  authors?: string;
  isbn?: string;
  coverUrl?: string;
  conflictPolicy?: "rename" | "skip" | "overwrite";
}
export interface LibraryGateway<T> {
  fetchLibraryBooks(params: LoadLibraryParams): Promise<LibraryListResponse>;
  addBookManual(params: AddBookManualParams): Promise<LibraryBook>;
  importBook(params: ImportRequest<T>): Promise<LibraryBook>;
  updateLibraryBook(
    id: number,
    data: Partial<LibraryBook>,
  ): Promise<LibraryBook>;
  deleteLibraryBook(id: number): Promise<{
    deleted: boolean;
    bookId: number;
  }>;
  batchDeleteLibraryBooks(ids: number[]): Promise<{
    deletedIds: number[];
  }>;
  clearBookFileCacheForBook(userId: number, bookId: number): Promise<void>;
  saveViewMode(mode: ViewMode): void;
  peek?(params: LoadLibraryParams): LibraryListResponse | undefined;
  invalidate?(): void;
}
export function createLibraryState() {
  return {
    books: [] as LibraryBook[],
    loading: false,
    error: null as string | null,
    viewMode: "grid" as ViewMode,
    selectedBookIds: [] as number[],
    pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
    activeQuery: { page: 1, pageSize: 20 } as LoadLibraryParams,
  };
}
export function createLibraryController<FileInput>(
  state: ReturnType<typeof createLibraryState>,
  api: LibraryGateway<FileInput>,
) {
  let loadGeneration = 0;
  let disposed = false;
  // API uses numeric IDs
  // 视图切换
  const setViewMode = (mode: ViewMode) => {
    state.viewMode = mode;
    api.saveViewMode(mode);
  };
  const loadLibrary = async (
    params: LoadLibraryParams = {},
    options: LoadLibraryOptions = {},
  ) => {
    if (disposed) throw new Error("书架会话已销毁");
    if (options.silent && state.loading) return;
    const token = ++loadGeneration;
    const query = { ...state.activeQuery, ...params };
    const cached = api.peek?.(query);
    if (cached) {
      state.books = cached.items;
      state.pagination = {
        page: cached.page,
        pageSize: cached.pageSize,
        total: cached.total,
        totalPages: Math.max(1, Math.ceil(cached.total / cached.pageSize)),
      };
    }
    if (!options.silent) {
      state.loading = !cached;
      state.error = null;
    }
    try {
      state.activeQuery = query;
      const data = await api.fetchLibraryBooks(query);
      if (disposed || token !== loadGeneration) return;
      const lastPage = Math.max(1, Math.ceil(data.total / data.pageSize));
      if (data.page > lastPage) {
        state.loading = false;
        await loadLibrary(
          { page: lastPage },
          { silent: !!state.books.length, preserveSelection: true },
        );
        return;
      }
      state.error = null;
      state.books = data.items;
      state.pagination = {
        page: data.page,
        pageSize: data.pageSize,
        total: data.total,
        totalPages: Math.max(1, Math.ceil(data.total / data.pageSize)),
      };
      if (!options.preserveSelection) {
        state.selectedBookIds = []; // 加载新数据时清空选中
      }
    } catch (e: any) {
      if (!disposed && token === loadGeneration)
        state.error = e.message || "加载书架失败";
      throw e;
    } finally {
      if (!disposed && token === loadGeneration && !options.silent) {
        state.loading = false;
      }
    }
  };
  const importBookFromFile = async (params: ImportRequest<FileInput>) => {
    state.loading = true;
    state.error = null;
    try {
      await api.importBook(params);
      api.invalidate?.();
    } catch (e: any) {
      api.invalidate?.();
      state.error = e.message || "导入书籍失败";
      throw e;
    } finally {
      state.loading = false;
    }
  };
  const addBook = async (params: AddBookManualParams) => {
    state.loading = true;
    state.error = null;
    try {
      await api.addBookManual(params);
      api.invalidate?.(); // 写入和查询错误分别呈现
    } catch (e: any) {
      api.invalidate?.();
      state.error = e.message || "添加书籍失败";
      throw e;
    } finally {
      state.loading = false;
    }
  };
  // 批量选择
  const toggleSelect = (id: number) => {
    const index = state.selectedBookIds.indexOf(id);
    if (index > -1) state.selectedBookIds.splice(index, 1);
    else state.selectedBookIds.push(id);
  };
  const toggleSelectAll = (ids: number[]) => {
    if (state.selectedBookIds.length === ids.length && ids.length > 0) {
      state.selectedBookIds = [];
    } else {
      state.selectedBookIds = [...ids];
    }
  };
  const clearSelection = () => {
    state.selectedBookIds = [];
  };
  const clearDeletedBookCaches = (
    targets: Array<{
      userId: number;
      bookId: number;
    }>,
  ) => {
    const uniqueTargets = Array.from(
      new Map(
        targets.map((target) => [`${target.userId}:${target.bookId}`, target]),
      ).values(),
    );
    void Promise.allSettled(
      uniqueTargets.map((target) =>
        api.clearBookFileCacheForBook(target.userId, target.bookId),
      ),
    );
  };
  // 删除书籍
  const deleteBooks = async (ids: number[]) => {
    state.loading = true;
    state.error = null;
    try {
      const booksById = new Map(state.books.map((book) => [book.id, book]));
      let deletedIds: number[] = [];
      if (ids.length === 1) {
        const result = await api.deleteLibraryBook(ids[0]);
        deletedIds = result.deleted ? [result.bookId] : [];
      } else if (ids.length > 1) {
        const result = await api.batchDeleteLibraryBooks(ids);
        deletedIds = result.deletedIds;
      }
      clearDeletedBookCaches(
        deletedIds
          .map((bookId) => booksById.get(bookId))
          .filter((book): book is LibraryBook => !!book)
          .map((book) => ({ userId: book.userId, bookId: book.id })),
      );
      api.invalidate?.(); // 写入和查询错误分别呈现
    } catch (e: any) {
      api.invalidate?.();
      state.error = e.message || "删除失败";
      throw e;
    } finally {
      state.loading = false;
    }
  };
  // 更新书籍元数据
  const updateBookMetadata = async (
    id: number,
    newData: Partial<LibraryBook>,
  ) => {
    state.loading = true;
    state.error = null;
    try {
      // 剔除只读字段，只保留 PATCH 接口允许的字段
      const {
        title,
        authors,
        isbn,
        language,
        coverUrl,
        description,
        publisher,
        publishYear,
        editionTag,
      } = newData;
      await api.updateLibraryBook(id, {
        title,
        authors,
        isbn,
        language,
        coverUrl,
        description,
        publisher,
        publishYear,
        editionTag,
      });
      api.invalidate?.(); // 写入和查询错误分别呈现
    } catch (e: any) {
      api.invalidate?.();
      state.error = e.message || "保存失败";
      throw e;
    } finally {
      state.loading = false;
    }
  };
  function dispose() {
    disposed = true;
    loadGeneration++;
  }
  return {
    setViewMode,
    loadLibrary,
    addBook,
    importBookFromFile,
    toggleSelect,
    toggleSelectAll,
    clearSelection,
    deleteBooks,
    updateBookMetadata,
    dispose,
  };
}
