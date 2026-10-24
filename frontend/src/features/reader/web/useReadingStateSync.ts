import { reactive, toRefs } from 'vue';
import { createReadingStateState, createReadingStateController } from '../domain/readingState';
import { getReadingState, openReadingStateStream } from '../api/readingStateApi';
import { getReaderDeviceId } from './useReaderProgress';
/** 作用域：单次开书会话；focus 和 SSE 由 Web 绑定，revision 收敛由核心负责。 */
export function useReadingStateSync(bookId: number) {
    const state = reactive(createReadingStateState());
    const controller = createReadingStateController(state, bookId, { getReadingState, openReadingStateStream, deviceId: getReaderDeviceId, onFocus(callback) { window.addEventListener('focus', callback); return () => window.removeEventListener('focus', callback); } });
    return { ...toRefs(state), ...controller };
}
