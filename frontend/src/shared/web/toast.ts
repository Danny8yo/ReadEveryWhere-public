// 页面内提示（替代 window.alert）：成功、失败等结果短暂显示在屏幕底部，不打断操作。
// 由 App.vue 里的 UiToastHost 渲染；业务代码只调用 showToast。
import { reactive, readonly } from 'vue';

export type ToastTone = 'ok' | 'err' | 'info';
export interface Toast {
    id: number;
    message: string;
    tone: ToastTone;
}

const state = reactive({ items: [] as Toast[] });
let nextId = 1;
const timers = new Map<number, number>();

export function dismissToast(id: number) {
    const index = state.items.findIndex(item => item.id === id);
    if (index >= 0) state.items.splice(index, 1);
    const timer = timers.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.delete(id);
}

/** 失败提示停留更久，方便看清原因；同时最多保留 3 条 */
export function showToast(message: string, tone: ToastTone = 'info') {
    const id = nextId++;
    state.items.push({ id, message, tone });
    while (state.items.length > 3) dismissToast(state.items[0].id);
    timers.set(id, window.setTimeout(() => dismissToast(id), tone === 'err' ? 6000 : 3200));
    return id;
}

export const toasts = readonly(state);
