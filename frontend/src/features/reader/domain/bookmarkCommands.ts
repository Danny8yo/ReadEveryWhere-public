import type { Bookmark } from '../model/bookmark';
import type { BookmarkRecord, CreateBookmarkParams } from '../model/bookmark';
import { errorMessage } from '../../../shared/domain/errors';
export const toBookmark = (record: BookmarkRecord): Bookmark => ({ id: String(record.id), cfi: record.location, fraction: record.fraction, chapterLabel: record.chapterLabel ?? undefined });
export const createBookmarkState = () => ({ bookmarks: [] as Bookmark[], syncStatus: 'idle' as 'idle' | 'syncing' | 'synced' | 'failed', error: null as string | null });
// 书签已在其他设备删除（或网络重试）时服务器回复"书签不存在"，目标状态已达成。
const isBookmarkNotFound = (cause: unknown) => typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 40401;
export function createBookmarkController(state: ReturnType<typeof createBookmarkState>, api: {
    create(input: CreateBookmarkParams): Promise<BookmarkRecord>;
    delete(id: number): Promise<{
        deleted: boolean;
    }>;
}) {
    let disposed = false;
    async function remove(id: string) {
        if (disposed || state.syncStatus === 'syncing')
            return;
        state.syncStatus = 'syncing';
        state.error = null;
        try {
            await api.delete(Number(id));
            if (disposed)
                return;
            state.bookmarks = state.bookmarks.filter(bookmark => bookmark.id !== id);
            state.syncStatus = 'synced';
        }
        catch (cause) {
            if (disposed)
                return;
            if (isBookmarkNotFound(cause)) {
                state.bookmarks = state.bookmarks.filter(bookmark => bookmark.id !== id);
                state.syncStatus = 'synced';
                return;
            }
            state.syncStatus = 'failed';
            state.error = errorMessage(cause);
        }
    }
    async function toggle(input: CreateBookmarkParams) {
        if (disposed || state.syncStatus === 'syncing' || !input.location)
            return;
        const existing = state.bookmarks.find(bookmark => bookmark.cfi === input.location);
        if (existing) {
            if (!existing.id)
                throw new Error('服务端书签缺少 ID');
            await remove(existing.id);
            return;
        }
        state.syncStatus = 'syncing';
        state.error = null;
        try {
            const record = await api.create(input);
            if (disposed)
                return;
            const bookmark = toBookmark(record);
            state.bookmarks = [...state.bookmarks.filter(item => item.id !== bookmark.id), bookmark];
            state.syncStatus = 'synced';
        }
        catch (cause) {
            if (!disposed) {
                state.syncStatus = 'failed';
                state.error = errorMessage(cause);
            }
        }
    }
    return { remove, toggle, dispose() { disposed = true; } };
}
