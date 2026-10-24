// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { expect, it, vi } from 'vitest';
vi.mock('../features/reader/web/bookFileCache', () => ({ clearBookFileCacheForUser: vi.fn() }));
vi.mock('../views/LibraryView.vue', () => ({ default: { template: '<div>书架</div>' } }));
vi.mock('../views/SearchView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../views/SettingsView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../features/reader/ui/BookReader.vue', () => ({ default: { template: '<div />' } }));
it('preserves login inputs and registration request count during background verification', async () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  const response = (status: number, data: unknown) => new Response(JSON.stringify({ code: status === 200 ? 0 : status, data, message: 'test' }), { status, headers: { 'Content-Type': 'application/json' } });
  let finish!: (response: Response) => void;
  let fail!: (error: Error) => void;
  let initial = true;
  let registrationCalls = 0;
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url.endsWith('/auth/registration-status')) { registrationCalls++; return Promise.resolve(response(200, { registrationEnabled: true })); }
    if (!url.endsWith('/auth/session')) throw new Error(`Unexpected request ${url}`);
    if (initial) { initial = false; return Promise.resolve(response(401, null)); }
    return new Promise<Response>((resolve, reject) => { finish = resolve; fail = reject; });
  }));
  const wrapper = mount((await import('../App.vue')).default);
  try {
    await flushPromises();
    const email = wrapper.get('input[type=email]');
    const password = wrapper.get('input[type=password]');
    await email.setValue('unfinished@example.com');
    await password.setValue('half-typed-password');
    const preserved = () => {
      expect(wrapper.get('input[type=password]').element).toBe(password.element);
      expect((password.element as HTMLInputElement).value).toBe('half-typed-password');
      expect((email.element as HTMLInputElement).value).toBe('unfinished@example.com');
      expect(registrationCalls).toBe(1);
    };
    for (const event of ['focus', 'online']) {
      window.dispatchEvent(new Event(event)); await flushPromises(); preserved();
      finish(response(401, null)); await flushPromises(); preserved();
    }
    for (const failure of ['network', 'server']) {
      window.dispatchEvent(new Event('focus')); await flushPromises(); preserved();
      if (failure === 'network') fail(new Error('offline')); else finish(response(503, null));
      await flushPromises(); preserved();
    }
    const { SESSION_EVENT_KEY } = await import('../shared/web/apiClient');
    const marker = JSON.stringify({ kind: 'changed', id: 'another-tab' });
    localStorage.setItem(SESSION_EVENT_KEY, marker);
    window.dispatchEvent(new StorageEvent('storage', { key: SESSION_EVENT_KEY, newValue: marker }));
    await flushPromises(); preserved();
    finish(response(200, { user: { userId: 2, email: 'other@example.com' } }));
    await flushPromises();
    expect(wrapper.find('input[type=password]').exists()).toBe(false);
    expect(wrapper.text()).toContain('书架');
  } finally { wrapper.unmount(); vi.unstubAllGlobals(); }
});
