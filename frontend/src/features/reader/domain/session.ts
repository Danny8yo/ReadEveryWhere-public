import type { ReaderPort } from './ReaderPort';
import type { ReadingStateSnapshot } from '../model/readingState';
import { errorMessage } from '../../../shared/domain/errors';
export const createReadingSessionState = () => ({ status: 'idle' as 'idle' | 'opening' | 'ready' | 'failed' | 'closed', error: null as string | null, navigationError: null as string | null });
/** 服务端快照成功并恢复位置后才进入 ready；会话关闭使所有迟到操作失效。 */
export function createReadingSession(state: ReturnType<typeof createReadingSessionState>, getReader: () => ReaderPort, sync: {
    load(): Promise<ReadingStateSnapshot>;
    connect(): void;
    dispose(): void;
}) {
    let generation = 0;
    async function initialize(apply: (snapshot: ReadingStateSnapshot) => void, restore: (snapshot: ReadingStateSnapshot) => Promise<void>) {
        const token = ++generation;
        state.status = 'opening';
        state.error = null;
        try {
            const snapshot = await sync.load();
            if (token !== generation)
                throw new Error('阅读会话已关闭');
            apply(snapshot);
            await restore(snapshot);
            if (token !== generation)
                throw new Error('阅读会话已关闭');
            sync.connect();
            state.status = 'ready';
        }
        catch (cause) {
            if (token === generation) {
                state.status = 'failed';
                state.error = errorMessage(cause);
            }
            throw cause;
        }
    }
    async function navigate(href: string): Promise<boolean> {
        const token = generation;
        state.navigationError = null;
        try {
            if (state.status !== 'ready')
                throw new Error('阅读器尚未就绪');
            await getReader().goToHref(href);
            return token === generation;
        }
        catch (cause) {
            if (token === generation)
                state.navigationError = `无法定位该章节：${errorMessage(cause)}`;
            return false;
        }
    }
    function close() { generation++; state.status = 'closed'; sync.dispose(); }
    return { initialize, navigate, close };
}
