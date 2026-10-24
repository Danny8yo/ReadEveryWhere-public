// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { withLibraryInvalidation } from '../features/library/web/librarySession';
import { importBooks } from '../features/library/web/importBooks';
import { useProfileMutations } from '../features/metadata/web/useProfileMutations';
import { useBookDetailActions } from '../features/book-detail/web/useBookDetailActions';
import { useBookAcquisition } from '../features/book-detail/web/useBookAcquisition';
import { useBatchMetadataReview } from '../features/metadata/web/useBatchMetadataReview';
import { useBookAnalysis } from '../features/metadata/web/useBookAnalysis';
import { useLibraryAnalysis } from '../features/library/web/useLibraryAnalysis';
import * as libraryApi from '../features/library/api/libraryApi';
import * as metadataApi from '../features/metadata/api/metadataApi';
import { bookAnalysisApi } from '../features/metadata/api/bookAnalysisApi';
import { downloadApi } from '../features/library/api/downloadApi';

const port = vi.hoisted(() => ({ invalidate: vi.fn() }));
// 记录哪些接口调用被交给了"写完就刷新书架"的包装函数。
const wrapped = vi.hoisted(() => [] as unknown[]);
vi.mock('../features/library/web/librarySession', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/library/web/librarySession')>();
  return {
    ...actual,
    useLibraryInvalidation: () => port,
    useLibrarySession: () => ({ cache: { updateBook: vi.fn() } }),
    withLibraryInvalidation: (p: typeof port, command: (...args: never[]) => Promise<unknown>) => {
      wrapped.push(command);
      return actual.withLibraryInvalidation(p, command);
    },
  };
});
vi.mock('../features/library/api/libraryApi', () => ({
  importBookWithMetadata: vi.fn(async () => ({ book: { id: 1 } })),
  importBooksBatch: vi.fn(async () => ({ items: [] })),
  updateBookReadingProfile: vi.fn(async () => ({ primaryGenre: null })),
  clearBookReadingProfile: vi.fn(async () => ({ primaryGenre: null })),
  addToLibraryFromSearch: vi.fn(async () => ({ id: 1 })),
  getLibraryBook: vi.fn(),
}));
vi.mock('../features/metadata/api/metadataApi', () => ({
  scrapeMetadata: vi.fn(),
  applyMetadataToBook: vi.fn(),
  searchDoubanRatingCandidates: vi.fn(),
  saveBookDoubanRating: vi.fn(async () => ({ sourceTitle: '书', rating: 8, ratingCount: 10, fetchedAt: 'now' })),
}));
vi.mock('../features/metadata/api/bookAnalysisApi', () => ({
  bookAnalysisApi: {
    getBookAnalysis: vi.fn(async () => null),
    analyzeBook: vi.fn(),
    analyzeBatch: vi.fn(),
    applyCandidate: vi.fn(async () => ({ profile: { primaryGenre: 'argumentation' } })),
  },
}));
vi.mock('../features/library/api/downloadApi', () => ({
  downloadApi: { createTask: vi.fn(), getTask: vi.fn(), cancelTask: vi.fn() },
}));
vi.mock('../features/settings/api/zlibraryApi', () => ({ zlibraryApi: { getConfig: vi.fn(async () => ({ baseUrl: null })) } }));

/** 在组件里调用组合函数（它们用到了生命周期钩子）。 */
function inComponent<T>(use: () => T): T {
  let result!: T;
  mount(defineComponent({ setup() { result = use(); return () => null; } }));
  return result;
}

beforeEach(() => {
  port.invalidate.mockClear();
  wrapped.length = 0;
});
afterEach(() => vi.clearAllMocks());

// 编号对应 doc/同步测试用例审查.md
describe('N6 本端写入成功后书架都会刷新', () => {
  it('包装函数：写入成功后刷新书架；写入失败或结果不明时同样刷新，并把错误继续抛出', async () => {
    const ok = withLibraryInvalidation(port, async (value: number) => value * 2);
    await expect(ok(21)).resolves.toBe(42);
    expect(port.invalidate).toHaveBeenCalledTimes(1);
    const failed = withLibraryInvalidation(port, async () => { throw new Error('超时，结果不明'); });
    await expect(failed()).rejects.toThrow('超时，结果不明');
    expect(port.invalidate).toHaveBeenCalledTimes(2);
  });

  it('批量导入：导入结束后刷新书架（成功或失败都刷新）', async () => {
    await importBooks({ files: ['a.epub'] } as never, port);
    expect(port.invalidate).toHaveBeenCalledTimes(1);
    vi.mocked(libraryApi.importBookWithMetadata).mockRejectedValueOnce(new Error('格式不支持'));
    await expect(importBooks({ files: ['b.epub'] } as never, port)).rejects.toThrow('格式不支持');
    expect(port.invalidate).toHaveBeenCalledTimes(2);
  });

  it('画像：保存、清除、应用 AI 结果后都刷新书架', async () => {
    const profile = inComponent(() => useProfileMutations(() => 42));
    await profile.save({ primaryGenre: null, secondaryGenres: [], classificationSummary: null });
    await profile.clear();
    await profile.apply('candidate-1', false);
    expect(port.invalidate).toHaveBeenCalledTimes(3);
  });

  it('豆瓣评分：保存选中的评分后刷新书架', async () => {
    const actions = inComponent(() =>
      useBookDetailActions({ isOpen: false, mode: 'library', book: { id: 'library:42' } as never, libraryBookId: 42 }, vi.fn()),
    );
    await actions.persistDoubanSelection({ title: '书' } as never);
    expect(metadataApi.saveBookDoubanRating).toHaveBeenCalledWith(42, { title: '书' });
    expect(port.invalidate).toHaveBeenCalledTimes(1);
  });

  // 以下入口要走完整业务流程（下载轮询、批量审核、分析轮询）才会写入，这里检查它们把写入接口交给了包装函数。
  it('采集入库：加入书架和创建下载任务都交给包装函数', () => {
    inComponent(() => useBookAcquisition(() => null, vi.fn()));
    expect(wrapped).toEqual(expect.arrayContaining([libraryApi.addToLibraryFromSearch, downloadApi.createTask]));
  });

  it('批量元数据：应用到书籍交给包装函数', () => {
    inComponent(() => useBatchMetadataReview({ isOpen: false, books: [], provider: 'douban' } as never, vi.fn() as never));
    expect(wrapped).toContain(metadataApi.applyMetadataToBook);
  });

  it('预分析：单本分析和批量分析都交给包装函数', () => {
    inComponent(() => useBookAnalysis(null, { immediate: false }));
    inComponent(() => useLibraryAnalysis(ref([]), ref([])));
    expect(wrapped).toEqual(expect.arrayContaining([bookAnalysisApi.analyzeBook, bookAnalysisApi.analyzeBatch]));
  });
});
