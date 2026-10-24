// @vitest-environment happy-dom
// 封面流 P2 应用外壳：导航唯一、当前页标记、页面内退出确认。
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), logoutApi: vi.fn() }));
vi.mock('../features/auth/api/authApi', () => ({ getSession: mocks.getSession, loginRemote: vi.fn(), registerRemote: vi.fn(), resetPasswordApi: vi.fn(), logoutApi: mocks.logoutApi }));
vi.mock('../features/library/api/librarySyncApi', () => ({ openLibraryStream: () => () => {}, getLibrarySyncState: vi.fn() }));
vi.mock('../features/reader/web/bookFileCache', () => ({ clearBookFileCacheForUser: vi.fn() }));
vi.mock('../views/LibraryView.vue', () => ({ default: { template: '<p data-testid="page">library</p>' } }));
vi.mock('../views/SearchView.vue', () => ({ default: { template: '<p data-testid="page">search</p>' } }));
vi.mock('../views/SettingsView.vue', () => ({ default: { template: '<p data-testid="page">settings</p>' } }));
vi.mock('../views/LoginView.vue', () => ({ default: { template: '<p data-testid="page">login</p>' } }));
vi.mock('../features/reader/ui/BookReader.vue', () => ({ default: { template: '<div />' } }));

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

async function mountApp() {
  const values = new Map<string, string>([['readEveryWhere.backendBaseUrl', 'http://localhost:3000']]);
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  mocks.getSession.mockResolvedValue({ user: { userId: 7, email: 'reader@example.test' } });
  document.body.innerHTML = '<div id="app"></div>';
  const App = (await import('../App.vue')).default;
  const wrapper = mount(App, { attachTo: document.getElementById('app')! });
  await flushPromises();
  return wrapper;
}

it('只有一个 nav，切换标签时标记当前页', async () => {
  const wrapper = await mountApp();
  expect(document.querySelectorAll('nav')).toHaveLength(1);
  expect(wrapper.get('[data-testid="page"]').text()).toBe('library');
  const current = () => [...document.querySelectorAll('nav button')].filter(b => b.getAttribute('aria-current') === 'page').map(b => b.textContent?.trim());
  expect(current()).toEqual(['书架']);
  await wrapper.findAll('nav button').find(b => b.text() === '采集')!.trigger('click');
  expect(wrapper.get('[data-testid="page"]').text()).toBe('search');
  expect(current()).toEqual(['采集']);
  wrapper.unmount();
});

it('点退出先弹页面内确认：取消不退出，确认后才调用退出接口', async () => {
  mocks.logoutApi.mockResolvedValue(undefined);
  const confirmSpy = vi.fn();
  vi.stubGlobal('confirm', confirmSpy);
  const wrapper = await mountApp();
  const logoutButton = wrapper.findAll('button').find(b => b.text() === '退出')!;

  await logoutButton.trigger('click');
  await nextTick(); await nextTick();
  let dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.getAttribute('aria-labelledby')).toBe('logout-title');
  expect(dialog.textContent).toContain('退出登录？');
  [...dialog.querySelectorAll('button')].find(b => b.textContent?.trim() === '取消')!.click();
  await flushPromises();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(mocks.logoutApi).not.toHaveBeenCalled();

  await logoutButton.trigger('click');
  await nextTick(); await nextTick();
  dialog = document.querySelector('[role="dialog"]')!;
  [...dialog.querySelectorAll('button')].find(b => b.textContent?.trim() === '退出登录')!.click();
  await flushPromises();
  expect(mocks.logoutApi).toHaveBeenCalledTimes(1);
  expect(confirmSpy).not.toHaveBeenCalled();
  wrapper.unmount();
});
