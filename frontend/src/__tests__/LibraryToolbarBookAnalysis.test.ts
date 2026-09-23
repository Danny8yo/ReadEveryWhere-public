// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import LibraryToolbar from '../components/library/LibraryToolbar.vue';

function mountToolbar(selectedCount: number, isBatchAnalyzing = false) {
  return mount(LibraryToolbar, {
    props: {
      viewMode: 'grid',
      selectedCount,
      totalCount: 8,
      searchQuery: '',
      selectedFormats: [],
      isBatchAnalyzing,
    } as never,
  });
}

describe('LibraryToolbar AI 预分析入口', () => {
  it('未选择书籍时禁用批量按钮且不触发事件', async () => {
    const wrapper = mountToolbar(0);
    const button = wrapper.get('button[aria-label="批量 AI 预分析"]');

    expect(button.attributes()).toHaveProperty('disabled');
    await button.trigger('click');
    expect(wrapper.emitted('batch-analyze')).toBeUndefined();
  });

  it('选择书籍后触发 batch-analyze', async () => {
    const wrapper = mountToolbar(2);
    const button = wrapper.get('button[aria-label="批量 AI 预分析"]');

    expect(button.attributes()).not.toHaveProperty('disabled');
    await button.trigger('click');
    expect(wrapper.emitted('batch-analyze')).toEqual([[]]);
  });

  it('批量分析进行中禁用重复提交并显示明确状态', () => {
    const wrapper = mountToolbar(2, true);
    const button = wrapper.get('button[aria-label="批量 AI 预分析"]');

    expect(button.attributes()).toHaveProperty('disabled');
    expect(button.text()).toContain('AI 预分析中');
  });

  it('批量按钮旁提供独立帮助控件', () => {
    const wrapper = mountToolbar(1);

    expect(wrapper.get('button[aria-label="AI 预分析说明"]').text()).toBe('?');
  });
});
