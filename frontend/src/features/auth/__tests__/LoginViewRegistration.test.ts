// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Component } from 'vue';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mocks = vi.hoisted(() => ({
  getRegistrationStatus: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
}));

vi.mock('../api/authApi', () => ({
  getRegistrationStatus: mocks.getRegistrationStatus,
}));

vi.mock('../web/useAuth', async () => {
  const { ref } = await import('vue');
  return {
    useAuth: () => ({
      login: mocks.login,
      register: mocks.register,
      loading: ref(false),
      error: ref(null),
    }),
  };
});

describe('LoginView registration availability', () => {
  let LoginView: Component;

  beforeAll(async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size; },
    });
    LoginView = (await import('../../../views/LoginView.vue')).default;
  });

  beforeEach(() => {
    mocks.getRegistrationStatus.mockReset();
  });

  afterEach(() => vi.clearAllMocks());

  it('keeps registration available when the backend enables it', async () => {
    mocks.getRegistrationStatus.mockResolvedValue({ registrationEnabled: true });
    const wrapper = mount(LoginView);
    await flushPromises();

    const switchButton = wrapper.get('button.login-view__switch');
    expect(switchButton.text()).toContain('创建新账号');
    await switchButton.trigger('click');
    expect(wrapper.text()).toContain('确认密码');
    expect(wrapper.get('button[type="submit"]').text()).toBe('注册');
  });

  it('shows the closed notice and no registration control when disabled', async () => {
    mocks.getRegistrationStatus.mockResolvedValue({ registrationEnabled: false });
    const wrapper = mount(LoginView);
    await flushPromises();

    expect(wrapper.text()).toContain('当前为私有测试阶段，暂不开放注册。');
    expect(wrapper.find('button.login-view__switch').exists()).toBe(false);
    expect(wrapper.get('button[type="submit"]').text()).toBe('登录');
  });

  it('fails closed visibly when registration status cannot be loaded', async () => {
    mocks.getRegistrationStatus.mockRejectedValue(new Error('network unavailable'));
    const wrapper = mount(LoginView);
    await flushPromises();

    expect(wrapper.text()).toContain('暂时无法确认注册状态，请稍后刷新。');
    expect(wrapper.find('button.login-view__switch').exists()).toBe(false);
    expect(wrapper.get('button[type="submit"]').text()).toBe('登录');
  });

  it('reflects a changed backend state after the page is mounted again', async () => {
    mocks.getRegistrationStatus.mockResolvedValueOnce({ registrationEnabled: true });
    const openView = mount(LoginView);
    await flushPromises();
    expect(openView.find('button.login-view__switch').exists()).toBe(true);
    openView.unmount();

    mocks.getRegistrationStatus.mockResolvedValueOnce({ registrationEnabled: false });
    const closedView = mount(LoginView);
    await flushPromises();
    expect(closedView.text()).toContain('当前为私有测试阶段，暂不开放注册。');
    expect(closedView.find('button.login-view__switch').exists()).toBe(false);
  });

  it('背景封面墙的图片都随应用打包，并在 CREDITS.md 里写明出处', async () => {
    mocks.getRegistrationStatus.mockResolvedValue({ registrationEnabled: true });
    const wrapper = mount(LoginView);
    await flushPromises();

    // vitest 从 frontend 根目录运行；happy-dom 下 import.meta.url 不是 file: 地址
    const publicDir = resolve(process.cwd(), 'public') + '/';
    const credits = readFileSync(`${publicDir}login-covers/CREDITS.md`, 'utf8');
    const sources = wrapper.findAll('.login-view__mosaic img').map(img => img.attributes('src')!);
    expect(sources.length).toBeGreaterThanOrEqual(18);
    expect(new Set(sources).size).toBe(sources.length);
    for (const src of sources) {
      const file = src.replace(/^\//, '');
      expect(file).toMatch(/^login-covers\/[a-z]+\.webp$/);
      expect(existsSync(publicDir + file), file).toBe(true);
      expect(credits, file).toContain(file.replace('login-covers/', ''));
    }
  });
});
