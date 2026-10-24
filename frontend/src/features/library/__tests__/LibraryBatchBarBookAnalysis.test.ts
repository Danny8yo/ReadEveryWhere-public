// @vitest-environment happy-dom
// 批量 AI 预分析入口在封面流 P3 从书架工具栏移到了底部批量操作条（LibraryBatchBar）。
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import LibraryBatchBar from '../ui/LibraryBatchBar.vue';
import LibraryToolbar from '../ui/LibraryToolbar.vue';

function mountBar(selectedCount: number, isBatchAnalyzing = false) {
  return mount(LibraryBatchBar, { props: { selectedCount, isBatchAnalyzing } });
}

describe('批量操作条 AI 预分析入口', () => {
  it('未选择书籍时禁用批量按钮且不触发事件', async () => {
    const wrapper = mountBar(0);
    const button = wrapper.get('button[aria-label="批量 AI 预分析"]');

    expect(button.attributes()).toHaveProperty('disabled');
    await button.trigger('click');
    expect(wrapper.emitted('batch-analyze')).toBeUndefined();
  });

  it('选择书籍后触发 batch-analyze', async () => {
    const wrapper = mountBar(2);
    const button = wrapper.get('button[aria-label="批量 AI 预分析"]');

    expect(button.attributes()).not.toHaveProperty('disabled');
    await button.trigger('click');
    expect(wrapper.emitted('batch-analyze')).toEqual([[]]);
  });

  it('批量分析进行中禁用重复提交并显示明确状态', () => {
    const wrapper = mountBar(2, true);
    const button = wrapper.get('button[aria-label="批量 AI 预分析"]');

    expect(button.attributes()).toHaveProperty('disabled');
    expect(button.text()).toContain('AI 预分析中');
  });

  it('批量按钮旁提供独立帮助控件', () => {
    const wrapper = mountBar(1);

    expect(wrapper.get('button[aria-label="AI 预分析说明"]').text()).toBe('?');
  });

  it('删除和刮削在未选择时同样禁用，选中后带上刮削来源', async () => {
    const empty = mountBar(0);
    expect(empty.findAll('button').filter(b => ['删除', '批量刮削'].includes(b.text())).every(b => b.attributes('disabled') !== undefined)).toBe(true);
    const wrapper = mountBar(3);
    await wrapper.get('select[aria-label="批量刮削来源"]').setValue('douban');
    await wrapper.findAll('button').find(b => b.text() === '批量刮削')!.trigger('click');
    expect(wrapper.emitted('batch-scrape')).toEqual([['douban']]);
    await wrapper.findAll('button').find(b => b.text() === '删除')!.trigger('click');
    expect(wrapper.emitted('batch-delete')).toEqual([[]]);
  });
});

describe('书架工具栏', () => {
  it('视图切换按钮保留“封面墙/列表视图”名称并标记当前视图', async () => {
    const wrapper = mount(LibraryToolbar, { props: { viewMode: 'grid', totalCount: 8, searchQuery: '', selectedFormats: [] } });
    expect(wrapper.get('button[aria-label="封面墙"]').attributes('aria-pressed')).toBe('true');
    await wrapper.get('button[aria-label="列表视图"]').trigger('click');
    expect(wrapper.emitted('change-view')).toEqual([['list']]);
  });
});
