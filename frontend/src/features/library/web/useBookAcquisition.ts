import { useLibraryInvalidation, withLibraryInvalidation } from './librarySession';
import { reactive, computed, onBeforeUnmount } from 'vue';
import { createAcquisitionState, createAcquisitionController, isAcquisitionBusy } from '../domain/acquisition';
import { addToLibraryFromSearch } from '../api/libraryApi';
import { downloadApi } from '../api/downloadApi';
import { webScheduler } from '../../../shared/web/scheduler';
import type { BookDetailModel } from '../../../shared/model/bookDetail';
/** 作用域：详情容器实例；切换书籍时任务各自保留，销毁后停止本地观察。 */
export function useBookAcquisition(getBook: () => BookDetailModel | null, close: () => void) {
    const invalidation=useLibraryInvalidation();
    const state = reactive(createAcquisitionState());
    const key = (book: BookDetailModel) => `${book.sourcePlatform}:${book.sourceBookId || book.id}`;
    const currentKey = computed(() => { const book = getBook(); return book ? key(book) : null; });
    const closeTimers = new Set<number>();
    const controller = createAcquisitionController(state, {
        add: withLibraryInvalidation(invalidation,addToLibraryFromSearch), createTask: withLibraryInvalidation(invalidation,downloadApi.createTask), getTask: downloadApi.getTask,
    }, webScheduler, completedKey => {
        const timer = window.setTimeout(() => {
            closeTimers.delete(timer);
            if (currentKey.value === completedKey)
                close();
        }, 800);
        closeTimers.add(timer);
    });
    const currentJob = computed(() => currentKey.value ? state.jobs[currentKey.value] ?? null : null);
    const isCurrentBookAdding = computed(() => currentJob.value !== null && isAcquisitionBusy(currentJob.value));
    const addButtonLabel = computed(() => {
        const job = currentJob.value;
        if (!job)
            return '加入书架';
        if (isAcquisitionBusy(job) || job.phase === 'completed')
            return job.message;
        return job.phase === 'poll_failed' ? '重新读取下载进度' : '重试';
    });
    const acquisitionError = computed(() => {
        const job = currentJob.value;
        return job && ['failed', 'canceled', 'poll_failed'].includes(job.phase) ? job.message : null;
    });
    async function handleAddToLibrary() {
        const book = getBook();
        if (!book)
            return;
        const format = book.formats[0];
        if (!format)
            throw new Error('该搜索结果缺少可入库的电子书格式');
        await controller.add(key(book), {
            title: book.title, authors: book.authors, sourcePlatform: book.sourcePlatform, sourceBookId: book.sourceBookId,
            sourceUrl: book.detailUrl || '', coverUrl: book.coverUrl || '', description: book.description || '',
            isbn: book.identifier || book.isbn || '', publishYear: book.publishYear ?? 0, hash: book.hash ?? null, format,
        });
    }
    onBeforeUnmount(() => { controller.dispose(); closeTimers.forEach(timer => window.clearTimeout(timer)); });
    return { isCurrentBookAdding, addButtonLabel, acquisitionError, handleAddToLibrary };
}
