import { ref, readonly } from 'vue';
import type { ReaderBook } from '../model/readerBook';
/** 作用域：应用会话中的阅读器打开状态；退出登录清理。 */
const activeBook = ref<ReaderBook | null>(null);
if (typeof window !== 'undefined')
    window.addEventListener('auth:session-cleared', () => { activeBook.value = null; });
export function useReader() {
    return {
        activeBook: readonly(activeBook),
        openReader: (book: ReaderBook) => {
            activeBook.value = book;
        },
        closeReader: () => {
            activeBook.value = null;
        },
    };
}
