// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContinuousScroll } from '../lib/foliate-js/continuous-scroll.js';

vi.mock('../lib/foliate-js/section-view.js', () => ({
  SectionView: class {
    element = document.createElement('div');
    document = document.implementation.createHTMLDocument();
    loaded = false;
    constructor() {
      this.document.body.textContent = 'Reader fixture';
      this.element.getBoundingClientRect = () => new DOMRect(0, 0, 400, 800);
    }
    async load(_src: string, after: (doc: Document) => void, before: (layout: unknown) => void) {
      if (_src === 'tiny') this.element.getBoundingClientRect = () => new DOMRect(0, 0, 400, 20);
      after(this.document);
      before({ vertical: false, rtl: false });
    }
    render() {}
    destroy() {}
  },
}));
vi.mock('../lib/foliate-js/reader-range.js', () => ({
  getVisibleRange: (doc: Document) => {
    const range = doc.createRange(); range.selectNodeContents(doc.body);
    range.getBoundingClientRect = () => new DOMRect(0, 0, 400, 20);
    return range;
  },
  uncollapse: (anchor: unknown) => anchor,
}));

const controllers: ContinuousScroll[] = [];
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.destroy();
  document.body.replaceChildren();
});
function setup(loaders: Array<() => Promise<string>>) {
  const host = document.createElement('div'), container = document.createElement('div');
  document.body.append(host); host.append(container);
  container.getBoundingClientRect = () => new DOMRect(0, 0, 400, 400);
  const sections = loaders.map(load => ({ load, unload: vi.fn(), linear: 'yes' }));
  const relocate = vi.fn();
  const controller = new ContinuousScroll({ host, container, sections,
    layout: () => ({ flow: 'scrolled', width: 400, height: 400, margin: 0 }),
    styles: () => {}, relocate });
  controllers.push(controller);
  return { controller, host, container, sections, relocate };
}

describe('连续滚动生命周期', () => {
  it('极短章节在没有 scroll 事件时也能继续填满屏幕，且窗口有上限', async () => {
    const state = setup(Array.from({ length: 100 }, () => async () => 'tiny'));
    await state.controller.goTo({ index: 0 });
    await vi.waitFor(() => expect(state.controller.getContents().length).toBeGreaterThan(20));
    expect(state.controller.getContents().length).toBeLessThanOrEqual(64);
    expect(state.controller.index).toBe(0);
  });
  it('销毁后迟到的加载不得挂载正文或发送位置事件', async () => {
    let resolve!: (src: string) => void;
    const state = setup([() => new Promise<string>(done => { resolve = done; })]);
    const navigation = state.controller.goTo({ index: 0 });
    state.controller.destroy();
    resolve('late-section');
    await navigation;
    expect(state.controller.getContents()).toEqual([]);
    expect(state.relocate).not.toHaveBeenCalled();
    expect(state.sections[0]!.unload).toHaveBeenCalledOnce();
  });
  it('相邻章失败保留当前章，展示错误并允许用户重试', async () => {
    const adjacent = vi.fn().mockRejectedValueOnce(new Error('fixture failure')).mockResolvedValue('next');
    const state = setup([async () => 'current', adjacent]);
    await state.controller.goTo({ index: 0 });
    await vi.waitFor(() => expect(state.container.textContent).toContain('fixture failure'));
    expect(state.controller.getContents().map((item: { index: number }) => item.index)).toEqual([0]);
    state.container.querySelector('button')!.click();
    await vi.waitFor(() => expect(state.controller.getContents()).toHaveLength(2));
    expect(state.controller.index).toBe(0);
    expect(adjacent).toHaveBeenCalledTimes(2);
  });
  it('预加载就绪不会把当前阅读章节改为下一章，卸载会明确通知', async () => {
    const state = setup([async () => 'current', async () => 'next']);
    const unload = vi.fn(); state.host.addEventListener('unload', unload);
    await state.controller.goTo({ index: 0 });
    await vi.waitFor(() => expect(state.controller.getContents()).toHaveLength(2));
    expect(state.relocate.mock.calls.every(([event]) => event.index === 0)).toBe(true);
    state.controller.destroy();
    expect(unload).toHaveBeenCalledTimes(2);
    expect(state.sections.every(section => section.unload.mock.calls.length === 1)).toBe(true);
  });
});
