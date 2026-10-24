// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import MobileReaderToc from '../ui/MobileReaderToc.vue';
const items = [
  { label: '第一章', href: 'chapter1', subitems: [{ label: '第一节', href: 'chapter1#a' }, { label: '第二节', href: 'chapter1#b' }] },
  { label: '第二章', href: 'chapter2' },
];
const wrappers: ReturnType<typeof mount>[] = [];
function setup(extra = {}) {
  const wrapper = mount(MobileReaderToc, { props: { open: true, items, currentHref: 'chapter1#b', currentLabel: '第二节', error: null, busy: false, ...extra }, attachTo: document.body });
  wrappers.push(wrapper); return wrapper;
}
afterEach(() => { wrappers.forEach(w => w.unmount()); wrappers.length = 0; vi.restoreAllMocks(); });
describe('手机目录', () => {
  it('展开按钮只折叠目录，标题独立导航；当前读到重新展开祖先', async () => {
    const w = setup();
    await w.get('[aria-label="收起 第一章"]').trigger('click');
    expect(w.find('[aria-current="location"]').exists()).toBe(false);
    expect(w.emitted('navigate')).toBeUndefined();
    await w.get('.toc-current').trigger('click');
    expect(w.get('[aria-current="location"]').text()).toBe('第二节');
    await w.get('[aria-current="location"]').trigger('click');
    expect(w.emitted('navigate')).toEqual([['chapter1#b']]);
  });
  it('无目录和导航失败明确展示；忙碌时禁止重复跳转', async () => {
    const w = setup({ busy: true, error: '无法定位该章节' });
    expect(w.get('[role="alert"]').text()).toBe('无法定位该章节');
    expect(w.get('.toc-title').attributes('disabled')).toBeDefined();
    await w.setProps({ items: [], currentHref: '', error: null });
    expect(w.get('.toc-empty').text()).toContain('没有目录');
    expect(w.get('.toc-current').attributes('disabled')).toBeDefined();
  });
  it('顶部/底部跳转只滚动目录，不改变阅读位置', async () => {
    const w = setup(); const area = w.get('.toc-scroll').element as HTMLElement;
    Object.defineProperty(area, 'scrollHeight', { value: 1800 });
    await w.get('.toc-jumps button:last-child').trigger('click');
    expect(area.scrollTop).toBe(1800);
    await w.get('.toc-jumps button:first-child').trigger('click');
    expect(area.scrollTop).toBe(0); expect(w.emitted('navigate')).toBeUndefined();
  });
  it('关闭/搜本书有独立入口，Escape关闭并约束Tab焦点', async () => {
    const w = setup(); const section = w.get('section');
    const first = w.get('.toc-search').element as HTMLElement;
    const last = w.get('.toc-jumps button:last-child').element as HTMLElement;
    last.focus(); await section.trigger('keydown', { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    await section.trigger('keydown', { key: 'Escape' });
    expect(w.emitted('close')).toHaveLength(1);
    await w.get('.toc-search').trigger('click'); expect(w.emitted('search')).toHaveLength(1);
  });
});
