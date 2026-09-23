import type { Scheduler } from './scheduler';
/** 串行观察任务；停止后，已发出的请求不再安排下一次观察。 */
export function createPollingController(scheduler: Scheduler, refresh: () => Promise<void>, onError: (cause: unknown) => void, intervalMs: number) {
    let running = false;
    let generation = 0;
    let timer: number | null = null;
    async function tick(token: number) {
        timer = null;
        try {
            await refresh();
        }
        catch (cause) {
            if (running && token === generation)
                onError(cause);
        }
        if (running && token === generation)
            timer = scheduler.setTimeout(() => void tick(token), intervalMs);
    }
    function start() {
        if (running)
            return;
        running = true;
        const token = ++generation;
        timer = scheduler.setTimeout(() => void tick(token), intervalMs);
    }
    function stop() {
        running = false;
        generation++;
        if (timer !== null)
            scheduler.clearTimeout(timer);
        timer = null;
    }
    return { start, stop };
}
