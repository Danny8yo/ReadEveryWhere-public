import { randomId } from '../../../shared/web/randomId';
import { reactive, toRefs } from 'vue';
import { upsertProgress } from '../api/progressApi';
import { createProgressState, createProgressController } from '../domain/progress';
export function getReaderDeviceId(): string {
    let id = localStorage.getItem('readEveryWhere.deviceId');
    if (!id) {
        id = randomId();
        localStorage.setItem('readEveryWhere.deviceId', id);
    }
    return id;
}
/** 作用域：单书阅读会话。序号保留原存储键；卸载提交尚未发送的进度。 */
export function useReaderProgress(bookId: number) {
    const key = `readEveryWhere.readerSequence.${bookId}`;
    const state = reactive(createProgressState());
    const controller = createProgressController(state, bookId, { upsertProgress, deviceId: getReaderDeviceId,
        readSequence() { const stored = localStorage.getItem(key); const value = stored === null ? 0 : Number(stored); if (!Number.isSafeInteger(value) || value < 0)
            throw new Error('无效阅读进度设备序号'); return value; },
        writeSequence(value) { localStorage.setItem(key, String(value)); },
        setTimeout: (cb, ms) => window.setTimeout(cb, ms), clearTimeout: id => clearTimeout(id),
        requestAnimationFrame: cb => requestAnimationFrame(cb), cancelAnimationFrame: id => cancelAnimationFrame(id), hidden: () => document.visibilityState === 'hidden',
        onVisibility(callback) { document.addEventListener('visibilitychange', callback); return () => document.removeEventListener('visibilitychange', callback); },
    });
    return { ...toRefs(state), ...controller };
}
