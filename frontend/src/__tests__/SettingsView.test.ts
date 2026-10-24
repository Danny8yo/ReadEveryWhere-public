// @vitest-environment happy-dom
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, type Component } from 'vue';
import { toasts } from '../shared/web/toast';

const mocks = vi.hoisted(() => ({
  getZlibraryConfig: vi.fn(),
  deleteZlibraryConfig: vi.fn(),
  saveZlibraryConfig: vi.fn(),
  importZlibraryCookies: vi.fn(),
  updateBaseUrl: vi.fn(),
  getDoubanConfig: vi.fn(),
  getAiConfig: vi.fn(),
  deleteAiConfig: vi.fn(),
  saveAiConfig: vi.fn(),
  testAiConfig: vi.fn(),
}));

vi.mock('../features/settings/api/zlibraryApi', () => ({
  zlibraryApi: {
    getConfig: mocks.getZlibraryConfig,
    deleteConfig: mocks.deleteZlibraryConfig,
    saveConfig: mocks.saveZlibraryConfig,
    importCookies: mocks.importZlibraryCookies,
    updateBaseUrl: mocks.updateBaseUrl,
  },
}));
vi.mock('../features/settings/api/doubanApi', () => ({
  doubanApi: { getConfig: mocks.getDoubanConfig },
}));
vi.mock('../features/settings/api/aiModelApi', () => ({
  aiModelApi: {
    getModelConfig: mocks.getAiConfig,
    deleteModelConfig: mocks.deleteAiConfig,
    saveModelConfig: mocks.saveAiConfig,
    testModelConfig: mocks.testAiConfig,
  },
}));
vi.mock('../features/auth/web/useAuth', async () => {
  const { ref } = await import('vue');
  return {
    useAuth: () => ({
      user: ref({ email: 'reader@example.com' }),
      resetPassword: vi.fn(),
      loading: ref(false),
      error: ref(null),
    }),
  };
});

const zlibraryConfig = (hasStoredConfig: boolean, baseUrl: string | null = 'https://default.example') => ({
  hasStoredConfig,
  baseUrl,
  downloadsToday: 0,
  downloadsLimit: 10,
  isPremium: false,
  lastLoginAt: null,
  loginStatus: 'pending' as const,
});

// 封面流 P7：删除确认改为页面内弹窗（Teleport 到 body），提示改为页面内 toast
enableAutoUnmount(afterEach);
async function answerDeleteDialog(accept: boolean) {
  await nextTick(); await nextTick();
  const dialog = document.body.querySelector('[role="dialog"]');
  if (!dialog) throw new Error('没有出现删除确认框');
  const button = [...dialog.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === (accept ? '删除' : '取消'));
  if (!button) throw new Error('确认框里找不到按钮');
  button.click();
  await flushPromises();
}
const toastShown = (message: string) => toasts.items.some((item) => item.message === message);

function buttonByText(wrapper: VueWrapper, label: string) {
  const button = wrapper.findAll('button').find((candidate) => candidate.text().includes(label));
  if (!button) throw new Error(`找不到按钮：${label}`);
  return button;
}

describe('SettingsView 配置删除', () => {
  let SettingsView: Component;

  beforeAll(async () => {
    SettingsView = (await import('../views/SettingsView.vue')).default;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('alert', vi.fn());
    vi.stubGlobal('confirm', vi.fn(() => true));
    mocks.getZlibraryConfig.mockResolvedValue(zlibraryConfig(true));
    mocks.getDoubanConfig.mockResolvedValue({ requestIntervalMs: 3000, cookie: '' });
    mocks.getAiConfig.mockResolvedValue({
      provider: 'deepseek',
      displayName: 'DeepSeek-V4-flash',
      modelId: 'custom-model',
      hasApiKey: false,
      updatedAt: '2026-09-03T00:00:00.000Z',
    });
    mocks.deleteZlibraryConfig.mockResolvedValue({ deleted: true });
    mocks.deleteAiConfig.mockResolvedValue({ deleted: true });
  });

  it('只保存 Model ID 时仍显示 AI 删除配置入口', async () => {
    const wrapper = mount(SettingsView);
    await flushPromises();
    await buttonByText(wrapper, 'AI 阅读').trigger('click');
    expect(wrapper.text()).toContain('删除配置');
  });

  it('AI 删除取消确认时不发送请求', async () => {
    const wrapper = mount(SettingsView);
    await flushPromises();
    await buttonByText(wrapper, 'AI 阅读').trigger('click');
    await buttonByText(wrapper, '删除配置').trigger('click');
    await answerDeleteDialog(false);
    expect(mocks.deleteAiConfig).not.toHaveBeenCalled();
  });

  it('AI 删除成功后清空临时结果并重新读取默认配置', async () => {
    mocks.getAiConfig
      .mockResolvedValueOnce({
        provider: 'deepseek', displayName: 'Custom', modelId: 'custom-model',
        hasApiKey: false, updatedAt: '2026-09-03T00:00:00.000Z',
      })
      .mockResolvedValueOnce({
        provider: 'deepseek', displayName: 'DeepSeek-V4-flash', modelId: 'deepseek-v4-flash',
        hasApiKey: false, updatedAt: null,
      });
    const wrapper = mount(SettingsView);
    await flushPromises();
    await buttonByText(wrapper, 'AI 阅读').trigger('click');
    await buttonByText(wrapper, '删除配置').trigger('click');
    await answerDeleteDialog(true);

    expect(mocks.deleteAiConfig).toHaveBeenCalledTimes(1);
    expect(mocks.getAiConfig).toHaveBeenCalledTimes(2);
    expect((wrapper.get('input[type="text"]').element as HTMLInputElement).value).toBe('deepseek-v4-flash');
    expect(wrapper.text()).not.toContain('删除配置');
  });

  it('AI 删除失败时显示明确错误并保留配置', async () => {
    mocks.deleteAiConfig.mockRejectedValue(new Error('delete rejected'));
    const wrapper = mount(SettingsView);
    await flushPromises();
    await buttonByText(wrapper, 'AI 阅读').trigger('click');
    await buttonByText(wrapper, '删除配置').trigger('click');
    await answerDeleteDialog(true);

    expect(wrapper.text()).toContain('delete rejected');
    expect(wrapper.text()).toContain('删除配置');
    expect(mocks.getAiConfig).toHaveBeenCalledTimes(1);
  });

  it('存在持久化 Z-Library 配置时显示删除入口，取消确认不发送请求', async () => {
    const wrapper = mount(SettingsView);
    await flushPromises();
    await buttonByText(wrapper, '删除配置').trigger('click');
    await answerDeleteDialog(false);
    expect(mocks.deleteZlibraryConfig).not.toHaveBeenCalled();
  });

  it('删除 Z-Library 配置后刷新默认状态并清空账号输入', async () => {
    mocks.getZlibraryConfig
      .mockResolvedValueOnce(zlibraryConfig(true, 'https://stored.example'))
      .mockResolvedValueOnce(zlibraryConfig(false, 'https://default.example'));
    const wrapper = mount(SettingsView);
    await flushPromises();
    await wrapper.get('input[type="email"]').setValue('reader@example.com');
    await buttonByText(wrapper, '删除配置').trigger('click');
    await answerDeleteDialog(true);

    expect(mocks.deleteZlibraryConfig).toHaveBeenCalledTimes(1);
    expect(mocks.getZlibraryConfig).toHaveBeenCalledTimes(2);
    expect((wrapper.get('input[type="email"]').element as HTMLInputElement).value).toBe('');
    expect((wrapper.get('input[type="url"]').element as HTMLInputElement).value).toBe('https://default.example');
    expect(toastShown('Zlibrary 配置已删除')).toBe(true);
    expect(wrapper.text()).not.toContain('删除配置');
  });

  it('Z-Library 删除失败时显示明确错误且保留删除入口', async () => {
    mocks.deleteZlibraryConfig.mockRejectedValue(new Error('network unavailable'));
    const wrapper = mount(SettingsView);
    await flushPromises();
    await buttonByText(wrapper, '删除配置').trigger('click');
    await answerDeleteDialog(true);

    expect(toastShown('删除失败: network unavailable')).toBe(true);
    expect(wrapper.text()).toContain('删除配置');
  });

  it('切换到 Cookie 导入模式后提交凭据并立即清空敏感输入', async () => {
    mocks.importZlibraryCookies.mockResolvedValue({
      ...zlibraryConfig(true, 'https://mirror.example'),
      loginStatus: 'success',
    });
    const wrapper = mount(SettingsView);
    await flushPromises();

    await buttonByText(wrapper, 'Cookie 导入').trigger('click');
    await wrapper.get('[data-testid="zlibrary-remix-userid"]').setValue('40432371');
    await wrapper.get('[data-testid="zlibrary-remix-userkey"]').setValue('private-remix-key');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(mocks.importZlibraryCookies).toHaveBeenCalledWith({
      remixUserid: '40432371',
      remixUserkey: 'private-remix-key',
      baseUrl: 'https://default.example',
    });
    expect((wrapper.get('[data-testid="zlibrary-remix-userid"]').element as HTMLInputElement).value).toBe('');
    expect((wrapper.get('[data-testid="zlibrary-remix-userkey"]').element as HTMLInputElement).value).toBe('');
  });

  it('Cookie 导入失败后仍清空敏感输入', async () => {
    mocks.importZlibraryCookies.mockRejectedValue(new Error('Cookie 验证失败'));
    const wrapper = mount(SettingsView);
    await flushPromises();

    await buttonByText(wrapper, 'Cookie 导入').trigger('click');
    await wrapper.get('[data-testid="zlibrary-remix-userid"]').setValue('40432371');
    await wrapper.get('[data-testid="zlibrary-remix-userkey"]').setValue('private-remix-key');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(toastShown('保存失败: Cookie 验证失败')).toBe(true);
    expect((wrapper.get('[data-testid="zlibrary-remix-userid"]').element as HTMLInputElement).value).toBe('');
    expect((wrapper.get('[data-testid="zlibrary-remix-userkey"]').element as HTMLInputElement).value).toBe('');
  });
});
