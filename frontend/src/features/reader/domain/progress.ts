import type { ProgressLocationType, ReadingProgressRecord, UpsertProgressParams } from '../model/progress';
export interface ProgressSnapshot {
    location: string;
    fraction: number;
    locationType: ProgressLocationType;
}
export interface ProgressHost {
    readSequence(): number;
    writeSequence(value: number): void;
    deviceId(): string;
    upsertProgress(input: UpsertProgressParams): Promise<ReadingProgressRecord>;
    setTimeout(callback: () => void, delay: number): number;
    clearTimeout(handle: number): void;
    requestAnimationFrame(callback: () => void): number;
    cancelAnimationFrame(handle: number): void;
    hidden(): boolean;
    onVisibility(callback: () => void): () => void;
}
const REMOTE_DEBOUNCE_MS = 1000;
export function createProgressState() {
    return {
        syncStatus: 'idle' as 'idle' | 'syncing' | 'synced' | 'failed',
        lastError: null as unknown,
    };
}
export function createProgressController(state: ReturnType<typeof createProgressState>, bookId: number, host: ProgressHost) {
    let stopVisibility: (() => void) | null = null;
    let scheduled: ProgressSnapshot | null = null;
    let pending: ProgressSnapshot | null = null;
    let raf: number | null = null;
    let remoteTimer: number | null = null;
    let lastSavedLocation: string | null = null;
    let lastIssuedSequence = host.readSequence();
    function nextSequence(): number {
        lastIssuedSequence += 1;
        host.writeSequence(lastIssuedSequence);
        return lastIssuedSequence;
    }
    function cancelRaf() {
        if (raf !== null) {
            host.cancelAnimationFrame(raf);
            raf = null;
        }
    }
    async function pushRemote(p: ProgressSnapshot): Promise<void> {
        if (remoteTimer !== null) {
            host.clearTimeout(remoteTimer);
            remoteTimer = null;
        }
        const deviceSequence = nextSequence();
        state.syncStatus = 'syncing';
        try {
            await host.upsertProgress({
                bookId,
                location: p.location,
                locationType: p.locationType,
                fraction: p.fraction,
                deviceId: host.deviceId(),
                deviceSequence,
            });
            if (deviceSequence === lastIssuedSequence) {
                state.syncStatus = 'synced';
                state.lastError = null;
            }
        }
        catch (error) {
            if (deviceSequence === lastIssuedSequence) {
                state.syncStatus = 'failed';
                state.lastError = error;
            }
        }
    }
    function scheduleRemote(p: ProgressSnapshot) {
        scheduled = p;
        if (remoteTimer !== null)
            host.clearTimeout(remoteTimer);
        remoteTimer = host.setTimeout(() => {
            remoteTimer = null;
            scheduled = null;
            void pushRemote(p);
        }, REMOTE_DEBOUNCE_MS);
    }
    function flush(immediate = false) {
        raf = null;
        const p = pending ?? (immediate ? scheduled : null);
        pending = null;
        if (immediate)
            scheduled = null;
        if (!p)
            return;
        if (!immediate && p.location && p.location === lastSavedLocation)
            return;
        lastSavedLocation = p.location;
        if (immediate)
            void pushRemote(p);
        else
            scheduleRemote(p);
    }
    /** 每次 relocate 调用；rAF 合并写盘，后台时同步提交。 */
    function record(p: ProgressSnapshot) {
        if (!p.location && !p.fraction)
            return;
        pending = p;
        if (host.hidden()) {
            cancelRaf();
            flush(true);
            return;
        }
        if (raf !== null)
            return;
        raf = host.requestAnimationFrame(() => flush(false));
    }
    function resolveInitialPosition(remote: ReadingProgressRecord | null): ProgressSnapshot | null {
        if (!remote)
            return null;
        lastSavedLocation = remote.location;
        return { location: remote.location, fraction: remote.fraction, locationType: remote.locationType };
    }
    function onVisibility() {
        if (host.hidden() && (pending || scheduled))
            flush(true);
    }
    function start() {
        stopVisibility = host.onVisibility(onVisibility);
    }
    function dispose() {
        if (pending || scheduled)
            flush(true);
        cancelRaf();
        if (remoteTimer !== null) {
            host.clearTimeout(remoteTimer);
            remoteTimer = null;
        }
        if (stopVisibility)
            stopVisibility();
    }
    return { record, resolveInitialPosition, pushRemote, start, dispose };
}
