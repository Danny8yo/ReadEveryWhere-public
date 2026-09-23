// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const envelope = (data: unknown, status = 200) => new Response(JSON.stringify({ code: status === 200 ? 0 : status, data }), { status });
describe('cookie session transport', () => {
  beforeEach(() => { vi.resetModules(); const values = new Map<string,string>(); vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }); });
  afterEach(() => vi.unstubAllGlobals());
  it('removes old credentials and sends cookies for JSON, SSE and multipart without bearer headers', async () => {
    localStorage.setItem('readEveryWhere.accessToken', 'old');
    localStorage.setItem('readEveryWhere.refreshToken', 'old-refresh');
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(envelope({ ok: true })));
    vi.stubGlobal('fetch', fetch);
    const api = await import('../services/apiClient');
    await api.request('/api/v1/library/books');
    await api.fetchWithAuth('/api/v1/reading-state/stream');
    await api.requestFormData('/api/v1/library/books/import', new FormData());
    expect(localStorage.getItem('readEveryWhere.accessToken')).toBeNull();
    expect(localStorage.getItem('readEveryWhere.refreshToken')).toBeNull();
    for (const [, options] of fetch.mock.calls) {
      expect(options.credentials).toBe('include');
      expect(new Headers(options.headers).has('Authorization')).toBe(false);
    }
  });
  it('network and server errors preserve the session; current 401 invalidates it', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const api = await import('../services/apiClient');
    api.saveAuthSession({ user: { userId: 1, email: 'test@example.test' } });
    const version = api.getSessionVersion();
    fetch.mockRejectedValueOnce(new TypeError('offline'));
    await expect(api.request('/api/v1/library/books')).rejects.toThrow('offline');
    fetch.mockResolvedValueOnce(envelope(null, 503));
    await expect(api.request('/api/v1/library/books')).rejects.toMatchObject({ code: 503 });
    expect(api.getSessionVersion()).toBe(version);
    fetch.mockResolvedValueOnce(envelope(null, 401));
    await expect(api.request('/api/v1/library/books')).rejects.toMatchObject({ code: 401 });
    expect(api.getSessionVersion()).not.toBe(version);
  });
  it('late 401 cannot clear a new session announced by another tab', async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(done => { resolve = done; })));
    const api = await import('../services/apiClient');
    const pending = api.fetchWithAuth('/api/v1/library/books');
    localStorage.setItem(api.SESSION_EVENT_KEY, JSON.stringify({ kind: 'changed', id: 'another-tab' }));
    resolve(envelope(null, 401)); await pending;
    expect(api.getSessionVersion()).toContain('another-tab');
  });
  it('does not claim login succeeded when the browser rejects the cookie', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(envelope({ user: { userId: 1, email: 'test@example.test' } }))
      .mockResolvedValueOnce(envelope(null, 401)));
    const { loginRemote } = await import('../features/auth/api/authApi');
    await expect(loginRemote('test@example.test', 'password')).rejects.toThrow('Cookie');
  });
  it('a rejected password does not discard the existing session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(envelope(null, 401)));
    const api = await import('../services/apiClient');
    api.saveAuthSession({ user: { userId: 1, email: 'test@example.test' } });
    const version = api.getSessionVersion();
    const { loginRemote } = await import('../features/auth/api/authApi');
    await expect(loginRemote('test@example.test', 'incorrect')).rejects.toMatchObject({ code: 401 });
    expect(api.getSessionVersion()).toBe(version);
  });
});
it('failed logout keeps the current session and exposes the error', async () => {
  const { createAuthenticationController, createAuthenticationState } = await import('../features/auth/domain/authentication');
  const clearSession = vi.fn();
  const state = createAuthenticationState();
  const controller = createAuthenticationController(state, {
    login: vi.fn(), register: vi.fn(), resetPassword: vi.fn(), saveSession: vi.fn(), clearSession,
    logout: vi.fn().mockRejectedValue(new Error('offline')),
  });
  expect(await controller.logout()).toBe(false);
  expect(clearSession).not.toHaveBeenCalled();
  expect(state.error).toBe('offline');
});
