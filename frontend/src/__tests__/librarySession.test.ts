// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLibrarySession } from '../features/library/web/librarySession';
import type { LibraryVersion } from '../features/library/model/sync';

const transport = vi.hoisted(() => ({
  open: vi.fn(),
  state: vi.fn(),
  stop: vi.fn(),
}));
vi.mock('../features/library/api/librarySyncApi', () => ({
  openLibraryStream: transport.open,
  getLibrarySyncState: transport.state,
}));
vi.mock('../features/library/api/libraryApi', () => ({ fetchLibraryBooks: vi.fn() }));
vi.mock('../services/apiClient', () => ({
  getBaseUrl: () => 'http://library.test',
  getSessionVersion: () => 'verified-session',
}));

afterEach(() => { vi.clearAllMocks(); });

describe('library session connection health', () => {
  it('does not mark a disconnected stream connected when its pending recovery succeeds', async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    let handlers!: { ready(version: LibraryVersion): void; error(error: unknown): void };
    transport.open.mockImplementation((value) => { handlers = value; return transport.stop; });
    let finishRecovery!: (version: LibraryVersion) => void;
    transport.state.mockImplementationOnce(() => new Promise<LibraryVersion>(resolve => { finishRecovery = resolve; }));
    const verify = vi.fn(async () => true);
    const session = createLibrarySession(7, verify);
    try {
      handlers.ready({ epoch: 'server', revision: 1 });
      // Join the same recovery already started by ready, without creating another GET.
      const recovery = session.recover();
      await Promise.resolve();
      expect(transport.state).toHaveBeenCalledTimes(1);
      handlers.error(new Error('连接已断开'));
      finishRecovery({ epoch: 'server', revision: 1 });
      await recovery;
      expect(session.status.connection).toBe('reconnecting');
      expect(session.status.error).toBe('连接已断开');

      // A later subscribed connection still needs successful state validation.
      transport.state.mockResolvedValueOnce({ epoch: 'server', revision: 2 });
      handlers.ready({ epoch: 'server', revision: 2 });
      await session.recover();
      expect(session.status.connection).toBe('connected');
      expect(session.status.error).toBeNull();
      expect(transport.state).toHaveBeenCalledTimes(2);
    } finally {
      session.dispose();
    }
    expect(transport.stop).toHaveBeenCalledOnce();
  });
});
