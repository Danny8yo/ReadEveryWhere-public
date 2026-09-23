/** 宿主提供计时器；核心不读取浏览器全局对象。 */
export interface Scheduler {
    setTimeout(callback: () => void, delayMs: number): number;
    clearTimeout(handle: number): void;
}
