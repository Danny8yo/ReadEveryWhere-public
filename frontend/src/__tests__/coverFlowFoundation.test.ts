// @vitest-environment happy-dom
// 封面流 P1 基础能力：生成封面配色、主题解析、浮层栈与统一浮层、封面兜底。
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { bookAccent, coverPalette, coverTitleSize, readingAccent } from '../shared/utils/coverPalette';
import { DEFAULT_THEME_PREFERENCE, parseThemePreference, resolveTheme } from '../shared/web/theme';
import { openOverlayCount, pushOverlay } from '../shared/web/overlayStack';
import UiOverlay from '../shared/ui/UiOverlay.vue';
import BookCover from '../shared/ui/BookCover.vue';

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  document.documentElement.className = '';
});
afterEach(() => {
  document.body.innerHTML = '';
});

describe('生成封面配色', () => {
  it('同一书名得到同一组颜色，不同书名通常不同', () => {
    expect(coverPalette('被讨厌的勇气')).toEqual(coverPalette('被讨厌的勇气'));
    expect(coverPalette('被讨厌的勇气').base).not.toBe(coverPalette('认知觉醒').base);
    expect(coverPalette('').base).toMatch(/^hsl\(/);
  });
  it('书名越长字越小，并限制在 8–15 之间', () => {
    expect(coverTitleSize('看见')).toBe(15);
    expect(coverTitleSize('额尔古纳河右岸')).toBeLessThan(15);
    expect(coverTitleSize('一'.repeat(40))).toBe(8);
  });
  it('书色优先使用后端封面主色，格式不对时退回哈希色', () => {
    expect(bookAccent('置身事内', '#9b2a20')).toBe('#9b2a20');
    expect(bookAccent('置身事内', 'red')).toBe(coverPalette('置身事内').base);
    expect(bookAccent('置身事内', null)).toBe(coverPalette('置身事内').base);
  });
  it('阅读器书色是可存进批注的 #rrggbb，亮度居中，三套阅读主题上都看得清', () => {
    for (const title of ['置身事内', '呐喊', '', 'A Very Long English Title']) {
      const hex = readingAccent(title);
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(readingAccent(title)).toBe(hex);
      const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
      const lightness = (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;
      expect(lightness).toBeGreaterThan(0.38);
      expect(lightness).toBeLessThan(0.5);
    }
    expect(readingAccent('呐喊', '#A33A2C')).toBe('#a33a2c');
    expect(readingAccent('呐喊', 'red')).toBe(readingAccent('呐喊'));
  });
});

describe('主题', () => {
  it('默认跟随系统，非法存储值回到默认', () => {
    expect(DEFAULT_THEME_PREFERENCE).toBe('system');
    expect(parseThemePreference('dark')).toBe('dark');
    expect(parseThemePreference('purple')).toBe(DEFAULT_THEME_PREFERENCE);
  });
  it('跟随系统时按系统深浅色解析', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
  });
});

describe('浮层栈', () => {
  it('有浮层时背景 inert 且锁定滚动，全部释放后恢复', () => {
    const releaseA = pushOverlay({});
    const releaseB = pushOverlay({});
    expect(document.getElementById('app')!.hasAttribute('inert')).toBe(true);
    expect(document.documentElement.classList.contains('ui-scroll-locked')).toBe(true);
    releaseA();
    releaseA();
    expect(openOverlayCount()).toBe(1);
    releaseB();
    expect(document.getElementById('app')!.hasAttribute('inert')).toBe(false);
    expect(document.documentElement.classList.contains('ui-scroll-locked')).toBe(false);
  });
  it('Esc 只关闭最上面一层', () => {
    const closed: string[] = [];
    const releaseA = pushOverlay({ onEscape: () => closed.push('A') });
    const releaseB = pushOverlay({ onEscape: () => closed.push('B') });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(closed).toEqual(['B']);
    releaseB();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(closed).toEqual(['B', 'A']);
    releaseA();
  });
});

describe('统一浮层 UiOverlay', () => {
  function host(initial = true) {
    const open = ref(initial);
    const closes = ref(0);
    const wrapper = mount(defineComponent({
      setup: () => () => [
        h('button', { id: 'trigger', onClick: () => { open.value = true; } }, '打开'),
        h(UiOverlay, { open: open.value, label: '测试浮层', testId: 'overlay', onClose: () => { closes.value++; open.value = false; } }, () => [
          h('button', { id: 'first' }, '第一个'),
          h('button', { id: 'last' }, '最后一个'),
        ]),
      ],
    }), { attachTo: document.getElementById('app')! });
    return { open, closes, wrapper };
  }

  it('渲染到 body 而不是 #app 里，并设置对话框语义', async () => {
    const { wrapper } = host();
    await nextTick();
    const panel = document.querySelector('[data-testid="overlay"]')!;
    expect(panel).not.toBeNull();
    expect(document.getElementById('app')!.contains(panel)).toBe(false);
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(panel.getAttribute('aria-label')).toBe('测试浮层');
    wrapper.unmount();
  });

  it('打开时焦点进入浮层，Esc 关闭后焦点回到触发按钮', async () => {
    const { open, closes, wrapper } = host(false);
    const trigger = document.getElementById('trigger')!;
    trigger.focus();
    trigger.click();
    await nextTick(); await nextTick(); await nextTick();
    expect(open.value).toBe(true);
    const panel = document.querySelector('[data-testid="overlay"]')!;
    expect(panel.contains(document.activeElement)).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick(); await nextTick(); await nextTick();
    expect(closes.value).toBe(1);
    expect(document.activeElement).toBe(trigger);
    expect(document.getElementById('app')!.hasAttribute('inert')).toBe(false);
    wrapper.unmount();
  });

  it('Tab 在浮层内循环', async () => {
    const { wrapper } = host();
    await nextTick(); await nextTick();
    const panel = document.querySelector<HTMLElement>('[data-testid="overlay"]')!;
    document.getElementById('last')!.focus();
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement?.id).toBe('first');
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement?.id).toBe('last');
    wrapper.unmount();
  });

  it('只有在遮罩上按下并松开才关闭，从面板里拖出来不关闭', async () => {
    const { closes, wrapper } = host();
    await nextTick();
    const panel = document.querySelector<HTMLElement>('[data-testid="overlay"]')!;
    const scrim = panel.parentElement!;
    panel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    scrim.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(closes.value).toBe(0);
    scrim.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    scrim.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(closes.value).toBe(1);
    wrapper.unmount();
  });

  it('卸载时释放背景 inert', async () => {
    const { wrapper } = host();
    await nextTick();
    expect(document.getElementById('app')!.hasAttribute('inert')).toBe(true);
    wrapper.unmount();
    expect(document.getElementById('app')!.hasAttribute('inert')).toBe(false);
  });
});

describe('BookCover', () => {
  it('没有封面地址时显示生成封面', () => {
    const wrapper = mount(BookCover, { props: { title: '被讨厌的勇气', author: '岸见一郎', coverUrl: null } });
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.get('[role="img"]').attributes('aria-label')).toBe('被讨厌的勇气');
    // 书名、作者通过 CSS 绘制，不作为 DOM 文本出现，避免页面上书名重复
    expect(wrapper.text()).toBe('');
    expect(wrapper.get('.book-cover__title').attributes('data-text')).toBe('被讨厌的勇气');
    expect(wrapper.get('.book-cover__author').attributes('data-text')).toBe('岸见一郎');
  });
  it('图片加载失败时退回生成封面，换地址后重新尝试', async () => {
    const wrapper = mount(BookCover, { props: { title: '活着', coverUrl: 'https://img.example.test/a.jpg' } });
    await wrapper.get('img').trigger('error');
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find('[role="img"]').exists()).toBe(true);
    await wrapper.setProps({ coverUrl: 'https://img.example.test/b.jpg' });
    expect(wrapper.find('img').attributes('src')).toBe('https://img.example.test/b.jpg');
  });
});
