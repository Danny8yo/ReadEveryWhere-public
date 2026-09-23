import { beforeEach, describe, expect, it, vi } from 'vitest';

const getReadingState = vi.fn();
const openReadingStateStream = vi.fn();
let focusHandler: (() => void) | undefined;
const stopStream = vi.fn();
vi.mock('../features/reader/api/readingStateApi', () => ({
  getReadingState: (...args: unknown[]) => getReadingState(...args),
  openReadingStateStream: (...args: unknown[]) => openReadingStateStream(...args),
}));

import { useReadingStateSync } from '../composables/reader/useReadingStateSync';

describe('useReadingStateSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).window = {
      addEventListener: vi.fn((type: string, handler: () => void) => {
        if (type === 'focus') focusHandler = handler;
      }),
      removeEventListener: vi.fn(),
    };
    (globalThis as any).localStorage = {
      getItem: vi.fn().mockReturnValue('test-device'),
      setItem: vi.fn(),
    };
    getReadingState.mockResolvedValue({ revision: 1, progress: null, bookmarks: [], annotations: [] });
    focusHandler = undefined;
    openReadingStateStream.mockReturnValue(stopStream);
  });

  it('loads an authoritative snapshot and refreshes on a newer SSE revision', async () => {
    const sync = useReadingStateSync(42);
    await sync.start();
    expect(sync.snapshot.value?.revision).toBe(1);

    getReadingState.mockResolvedValue({ revision: 2, progress: null, bookmarks: [{ id: 1 }], annotations: [] });
    const handlers = openReadingStateStream.mock.calls[0][1];
    await handlers.onChange({ bookId: 42, revision: 2, changed: ['bookmarks'] });

    expect(sync.snapshot.value?.revision).toBe(2);
    expect(sync.snapshot.value?.bookmarks).toHaveLength(1);
    sync.dispose();
  });

  it('does not refresh for an already applied revision', async () => {
    const sync = useReadingStateSync(42);
    await sync.start();
    const handlers = openReadingStateStream.mock.calls[0][1];
    await handlers.onChange({ bookId: 42, revision: 1, changed: ['progress'] });
    expect(getReadingState).toHaveBeenCalledTimes(1);
    sync.dispose();
  });

  it('refreshes on focus and after the stream reconnects', async () => {
    const sync = useReadingStateSync(42);
    await sync.start();
    const handlers = openReadingStateStream.mock.calls[0][1];
    handlers.onError(new Error('disconnected'));
    expect(sync.connectionStatus.value).toBe('reconnecting');

    getReadingState.mockResolvedValue({ revision: 2, progress: null, bookmarks: [], annotations: [] });
    await handlers.onOpen();
    expect(sync.connectionStatus.value).toBe('connected');
    expect(sync.snapshot.value?.revision).toBe(2);

    getReadingState.mockResolvedValue({ revision: 3, progress: null, bookmarks: [], annotations: [] });
    focusHandler?.();
    await vi.waitFor(() => expect(sync.snapshot.value?.revision).toBe(3));
    sync.dispose();
  });

  it('ignores an older snapshot revision', async () => {
    const sync = useReadingStateSync(42);
    await sync.start();
    getReadingState.mockResolvedValue({ revision: 0, progress: null, bookmarks: [{ id: 9 }], annotations: [] });
    await sync.refresh();
    expect(sync.snapshot.value).toMatchObject({ revision: 1, bookmarks: [] });
    sync.dispose();
  });

  it('stops the stream and removes focus compensation on dispose', async () => {
    const sync = useReadingStateSync(42);
    await sync.start();
    sync.dispose();
    expect(stopStream).toHaveBeenCalledTimes(1);
    expect(window.removeEventListener).toHaveBeenCalledWith('focus', expect.any(Function));
    expect(sync.connectionStatus.value).toBe('idle');
  });
});
