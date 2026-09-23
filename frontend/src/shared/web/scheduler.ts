import type { Scheduler } from '../domain/scheduler';
export const webScheduler: Scheduler = {
    setTimeout: (callback, delay) => window.setTimeout(callback, delay),
    clearTimeout: (handle) => window.clearTimeout(handle),
};
