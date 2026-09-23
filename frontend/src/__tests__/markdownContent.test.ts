// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import MarkdownContent from '../components/MarkdownContent.vue';
import { markdownText } from '../shared/domain/markdown';
describe('reading Markdown', () => {
  it('renders formatting while blocking HTML, remote images and model links', () => {
    const wrapper = mount(MarkdownContent, { props: { text: '# 标题\n\n**重点**\n\n- 一\n- 二\n\n```js\nalert(1)\n```\n\n<img src=x onerror=alert(1)>\n\n![图片](https://example.com/tracker) [链接](javascript:alert(1))\n\n[网站](https://example.com)' } });
    expect(wrapper.find('h1').text()).toBe('标题');
    expect(wrapper.find('strong').text()).toBe('重点');
    expect(wrapper.findAll('li')).toHaveLength(2);
    expect(wrapper.find('pre code').text()).toContain('alert(1)');
    expect(wrapper.find('img,a,script,iframe').exists()).toBe(false);
    expect(wrapper.html()).not.toContain('onerror="');
    wrapper.unmount();
  });
  it('turns validated citations into buttons even when the model wraps a marker in inline code', async () => {
    const wrapper = mount(MarkdownContent, { props: { text: '**书中**[[evidence:ok]] [[evidence:unknown]] `[[evidence:ok]]`', citationIds: ['ok'] } });
    expect(wrapper.findAll('button')).toHaveLength(2);
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('citation')).toEqual([['ok']]);
    expect(wrapper.text()).toContain('[引用尚未验证]');
    await wrapper.setProps({ disabled: true });
    expect(wrapper.get('button').attributes()).toHaveProperty('disabled');
    wrapper.unmount();
  });
  it('extracts visible text across Markdown formatting for partial annotation selection', () => {
    expect(markdownText('术语 **随机访问** 与 `顺序访问`')).toBe('术语 随机访问 与 顺序访问');
  });
});
