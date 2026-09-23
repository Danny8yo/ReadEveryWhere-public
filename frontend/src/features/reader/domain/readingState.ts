import type { ReadingStateSnapshot, ReadingStateChangedEvent, ReadingStateStreamHandlers } from '../model/readingState';
export type ReadingStateSyncStatus = 'idle' | 'syncing' | 'synced' | 'failed' | 'reconnecting';
export interface ReadingStateGateway {
    getReadingState(bookId: number): Promise<ReadingStateSnapshot>;
    openReadingStateStream(bookId: number, handlers: ReadingStateStreamHandlers, deviceId: string): () => void;
    deviceId(): string;
    onFocus(callback: () => void): () => void;
}
export function createReadingStateState() {
    return {
        snapshot: null as ReadingStateSnapshot | null,
        syncStatus: 'idle' as ReadingStateSyncStatus,
        connectionStatus: 'idle' as 'idle' | 'connecting' | 'connected' | 'reconnecting',
        lastError: null as unknown,
        lastChange: null as ReadingStateChangedEvent | null,
    };
}
export function createReadingStateController(state: ReturnType<typeof createReadingStateState>, bookId: number, api: ReadingStateGateway) {
    let disposed = false;
    let stopFocus: (() => void) | null = null;
    let stopStream: (() => void) | null = null;
    let focusListening = false;
    let refreshPromise: Promise<ReadingStateSnapshot> | null = null;
    let refreshAgain = false;
    async function refresh(): Promise<ReadingStateSnapshot> {
        if (disposed)
            throw new Error('阅读状态会话已结束');
        if (refreshPromise) {
            refreshAgain = true;
            return refreshPromise;
        }
        state.syncStatus = 'syncing';
        refreshPromise = api.getReadingState(bookId);
        try {
            const next = await refreshPromise;
            if (disposed)
                throw new Error('阅读状态会话已结束');
            if (!state.snapshot || next.revision >= state.snapshot.revision)
                state.snapshot = next;
            state.syncStatus = 'synced';
            state.lastError = null;
            return next;
        }
        catch (error) {
            state.syncStatus = 'failed';
            state.lastError = error;
            throw error;
        }
        finally {
            refreshPromise = null;
            if (!disposed && refreshAgain) {
                refreshAgain = false;
                void refresh().catch(() => undefined);
            }
        }
    }
    async function onChange(event: ReadingStateChangedEvent): Promise<void> {
        if (event.bookId !== bookId || event.revision <= (state.snapshot?.revision ?? -1))
            return;
        state.lastChange = event;
        await refresh();
    }
    function onFocus() {
        void refresh().catch(() => undefined);
    }
    function connect(): void {
        if (stopStream)
            return;
        state.connectionStatus = 'connecting';
        stopStream = api.openReadingStateStream(bookId, {
            onChange,
            onOpen: async () => {
                state.connectionStatus = 'connected';
                await refresh();
            },
            onError: (error) => {
                state.lastError = error;
                state.connectionStatus = 'reconnecting';
            },
        }, api.deviceId());
        if (!focusListening) {
            stopFocus = api.onFocus(onFocus);
            focusListening = true;
        }
    }
    async function load(): Promise<ReadingStateSnapshot> {
        return refresh();
    }
    async function start(): Promise<ReadingStateSnapshot> {
        const initial = await load();
        connect();
        return initial;
    }
    function dispose() {
        disposed = true;
        refreshAgain = false;
        stopStream?.();
        stopStream = null;
        state.connectionStatus = 'idle';
        if (focusListening) {
            if (stopFocus)
                stopFocus();
            stopFocus = null;
            focusListening = false;
        }
    }
    return { load, connect, start, refresh, dispose };
}
