// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  analysis,
  analysisLoading,
  analysisAnalyzing,
  analysisError,
  refreshAnalysisMock,
  analyzeMock,
} = vi.hoisted(() => {
  const mockRef = <T>(initialValue: T) => {
    let currentValue = initialValue;
    return {
      __v_isRef: true,
      get value() { return currentValue; },
      set value(next: T) { currentValue = next; },
    };
  };
  return {
    analysis: mockRef<Record<string, unknown> | null>(null),
    analysisLoading: mockRef(false),
    analysisAnalyzing: mockRef(false),
    analysisError: mockRef<string | null>(null),
    refreshAnalysisMock: vi.fn(),
    analyzeMock: vi.fn(),
  };
});

vi.mock('../composables/useBookAnalysis', () => ({
  useBookAnalysis: () => ({
    analysis,
    loading: analysisLoading,
    analyzing: analysisAnalyzing,
    error: analysisError,
    refresh: refreshAnalysisMock,
    analyze: analyzeMock,
  }),
}));

import AiReadingPanel from '../components/AiReadingPanel.vue';

function analysisState(status: string, stale = false) {
  return {
    status,
    stale,
    profile: status === 'ready' ? { primaryGenre: 'technical' } : null,
  };
}

async function mountPanel(status: string, stale = false) {
  analysis.value = analysisState(status, stale);
  const wrapper = mount(AiReadingPanel, {
    props: { bookId: 42, bookTitle: '结构化阅读' },
    global: {
      stubs: {
        AiReadingBudgetEditor: { template: '<div data-testid="budget-editor" />' },
      },
    },
  });
  await flushPromises();
  return wrapper;
}

function buttonByText(wrapper: ReturnType<typeof mount>, label: string) {
  const button = wrapper.findAll('button').find((candidate) => candidate.text().includes(label));
  if (!button) throw new Error(`找不到按钮：${label}`);
  return button;
}

describe('AiReadingPanel 预分析守卫', () => {
  beforeEach(() => {
    analysis.value = null;
    analysisLoading.value = false;
    analysisAnalyzing.value = false;
    analysisError.value = null;
    refreshAnalysisMock.mockReset();
    analyzeMock.mockReset().mockResolvedValue(undefined);
  });

  it('not_analyzed 时隐藏阅读目标入口并引导预分析', async () => {
    const wrapper = await mountPanel('not_analyzed');

    expect(wrapper.find('#ai-reading-goal').exists()).toBe(false);
    expect(wrapper.text()).toContain('AI 预分析后才能开始自主阅读');

    await buttonByText(wrapper, '对此书进行 AI 预分析').trigger('click');
    expect(analyzeMock).toHaveBeenCalledWith({ force: false });
  });

  it.each(['pending', 'running'])('%s 时显示分析中状态和刷新能力', async (status) => {
    const wrapper = await mountPanel(status);

    expect(wrapper.find('#ai-reading-goal').exists()).toBe(false);
    expect(wrapper.text()).toContain('AI 预分析中');

    await buttonByText(wrapper, '刷新状态').trigger('click');
    expect(refreshAnalysisMock).toHaveBeenCalledOnce();
  });

  it('failed 时隐藏任务入口并允许重新分析', async () => {
    const wrapper = await mountPanel('failed');

    expect(wrapper.find('#ai-reading-goal').exists()).toBe(false);
    expect(wrapper.text()).toContain('AI 预分析失败');

    await buttonByText(wrapper, '重新分析').trigger('click');
    expect(analyzeMock).toHaveBeenCalledWith({ force: true });
  });

  it('stale 时按无有效分析处理并要求重新分析', async () => {
    const wrapper = await mountPanel('stale', true);

    expect(wrapper.find('#ai-reading-goal').exists()).toBe(false);
    expect(wrapper.text()).toContain('书籍内容已变化，需要重新进行 AI 预分析');

    await buttonByText(wrapper, '重新分析').trigger('click');
    expect(analyzeMock).toHaveBeenCalledWith({ force: true });
  });

  it('即使状态为 ready，stale=true 也不得展示阅读目标入口', async () => {
    const wrapper = await mountPanel('ready', true);

    expect(wrapper.find('#ai-reading-goal').exists()).toBe(false);
    expect(wrapper.text()).toContain('书籍内容已变化，需要重新进行 AI 预分析');
  });

  it('只有 ready 且非 stale 时保留现有 AI 阅读流程', async () => {
    const wrapper = await mountPanel('ready');

    expect(wrapper.get('#ai-reading-goal').attributes('placeholder')).toContain('梳理作者');
    expect(wrapper.text()).toContain('阅读目标');
    expect(wrapper.text()).toContain('开始阅读');
  });
});

vi.mock('../features/library/web/librarySession', () => ({ useLibraryInvalidation: () => ({invalidate: vi.fn()}), withLibraryInvalidation: (_port: unknown, command: unknown) => command }));
