// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import BookAnalysisHelp from '../components/book-analysis/BookAnalysisHelp.vue';

const HELP_TEXT = 'AI 预分析会读取书籍元数据、目录和少量正文，识别书籍的阅读结构，为后续 AI 阅读选择合适策略。不会修改原文或批注。';

function mountHelp() {
  return mount(BookAnalysisHelp);
}

describe('BookAnalysisHelp', () => {
  it('使用独立且可访问的问号按钮', () => {
    const wrapper = mountHelp();
    const trigger = wrapper.get('button[aria-label="AI 预分析说明"]');

    expect(trigger.text()).toBe('?');
    expect(trigger.attributes('aria-expanded')).toBe('false');
  });

  it('鼠标悬停时显示说明，移出后隐藏', async () => {
    const wrapper = mountHelp();
    const trigger = wrapper.get('button[aria-label="AI 预分析说明"]');

    await trigger.trigger('mouseenter');
    expect(wrapper.text()).toContain(HELP_TEXT);

    await trigger.trigger('mouseleave');
    expect(wrapper.text()).not.toContain(HELP_TEXT);
  });

  it('键盘聚焦时显示说明，失焦后隐藏', async () => {
    const wrapper = mountHelp();
    const trigger = wrapper.get('button[aria-label="AI 预分析说明"]');

    await trigger.trigger('focus');
    expect(wrapper.text()).toContain(HELP_TEXT);

    await trigger.trigger('blur');
    expect(wrapper.text()).not.toContain(HELP_TEXT);
  });

  it('移动端点击可切换说明，并同步 aria-expanded', async () => {
    const wrapper = mountHelp();
    const trigger = wrapper.get('button[aria-label="AI 预分析说明"]');

    await trigger.trigger('click');
    expect(wrapper.text()).toContain(HELP_TEXT);
    expect(trigger.attributes('aria-expanded')).toBe('true');

    await trigger.trigger('click');
    expect(wrapper.text()).not.toContain(HELP_TEXT);
    expect(trigger.attributes('aria-expanded')).toBe('false');
  });
});
