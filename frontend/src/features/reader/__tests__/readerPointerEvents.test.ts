// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FoliateReaderAdapter } from '../web/adapters/FoliateReaderAdapter';

type Internals = {
  container: HTMLElement;
  view: unknown;
  boundDocs: Map<Document, () => void>;
  unbindContainer: (() => void) | null;
  bindInteraction(surface: Document | HTMLElement, doc: Document | null, index?: number): () => void;
};
let adapter: FoliateReaderAdapter;
let container: HTMLDivElement;
let doc: Document;
let target: HTMLElement;
let tap = vi.fn();
let hover = vi.fn();
let annotation = vi.fn();
let hitTest = vi.fn();

function click(surface: EventTarget, x: number, y = 200, detail = 1) {
  surface.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y, detail }));
}
function pointer(surface: EventTarget, type: string, x: number, buttons = 0) {
  surface.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'mouse', clientX: x, clientY: 200, buttons }));
}

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  const frame = document.createElement('iframe');
  container.append(frame);
  document.body.append(container);
  // 容器 x=100..500；iframe 原宽800、缩放为400，模拟固定布局 PDF/EPUB。
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 0, 400, 600));
  vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 0, 400, 600));
  Object.defineProperties(frame, { offsetWidth: { value: 800 }, offsetHeight: { value: 1200 } });
  doc = frame.contentDocument!;
  Object.defineProperty(doc.defaultView, 'frameElement', { configurable: true, value: frame });
  doc.body.innerHTML = '<p>Readable text for selection</p><a href="#note">note</a>';
  target = doc.querySelector('p')!;
  adapter = new FoliateReaderAdapter();
  hitTest = vi.fn().mockReturnValue([]);
  const internal = adapter as unknown as Internals;
  internal.container = container;
  internal.view = { renderer: { getContents: () => [{ index: 0, overlayer: { hitTest, hitTestAll: () => hitTest().length ? [hitTest()] : [] } }] },
    removeEventListener: vi.fn(), close: vi.fn(), remove: vi.fn() };
  internal.boundDocs.set(doc, internal.bindInteraction(doc, doc, 0));
  internal.unbindContainer = internal.bindInteraction(container, null);
  tap = vi.fn(); hover = vi.fn(); annotation = vi.fn();
  adapter.on('tap', tap);
  adapter.on('edge-hover', hover);
  adapter.on('tap-annotation', annotation);
});
afterEach(() => {
  adapter.destroy();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('Adapter 指针事件', () => {
  it('缩放 iframe 与外部留白走同一坐标和事件契约，每次只发一次', () => {
    click(target, 790); // 顶层 x=495，距右侧5px
    vi.advanceTimersByTime(300);
    expect(tap.mock.calls).toEqual([[{ side: 'next' }]]);
    click(container, 105);
    vi.advanceTimersByTime(300);
    expect(tap.mock.calls).toEqual([[{ side: 'next' }], [{ side: 'prev' }]]);
  });
  it('原正文静默区域现在发送显隐动作', () => {
    click(target, 200);
    vi.advanceTimersByTime(300);
    expect(tap).toHaveBeenCalledWith({ side: 'center' });
  });
  it('双击选字、右键及拖动不发送翻页', () => {
    pointer(target, 'pointerdown', 790, 1);
    click(target, 790);
    vi.advanceTimersByTime(100);
    pointer(target, 'pointerdown', 790, 1);
    click(target, 790, 200, 2);
    vi.advanceTimersByTime(300);
    expect(tap).not.toHaveBeenCalled();
    pointer(target, 'pointerdown', 790, 1);
    pointer(target, 'pointermove', 740, 1);
    click(target, 790);
    vi.advanceTimersByTime(300);
    expect(tap).not.toHaveBeenCalled();
    pointer(target, 'pointerdown', 790, 1);
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 2, clientX: 790 }));
    vi.advanceTimersByTime(300);
    expect(tap).not.toHaveBeenCalled();
  });
  it('点掉既有选区不翻页，下一次独立点击才可导航', () => {
    const range = doc.createRange();
    range.selectNodeContents(target);
    doc.getSelection()!.addRange(range);
    pointer(target, 'pointerdown', 790, 1);
    doc.getSelection()!.removeAllRanges();
    click(target, 790);
    vi.advanceTimersByTime(300);
    expect(tap.mock.calls).toEqual([[{ side: 'body' }]]);
    pointer(target, 'pointerdown', 790, 1);
    click(target, 790);
    vi.advanceTimersByTime(300);
    expect(tap.mock.calls).toEqual([[{ side: 'body' }], [{ side: 'next' }]]);
  });
  it('链接及批注优先，不触发翻页', () => {
    click(doc.querySelector('a')!, 790);
    vi.advanceTimersByTime(300);
    expect(tap).not.toHaveBeenCalled();
    hitTest.mockReturnValue(['annotation-1']);
    click(target, 790);
    vi.advanceTimersByTime(300);
    expect(tap).not.toHaveBeenCalled();
    expect(annotation).toHaveBeenCalledWith(expect.objectContaining({ anchorCfi: 'annotation-1', selectionError: '无法准确定位此批注，请重新选择原文后询问 AI', rect: { x: 495, y: 100, width: 0, height: 0 } }));
  });
  it('悬停仅报告有效鼠标边缘，正文、触屏及交互内容清除提示', () => {
    pointer(target, 'pointermove', 790);
    expect(hover).toHaveBeenLastCalledWith({ edge: 'right', side: 'next' });
    pointer(target, 'pointermove', 400);
    expect(hover).toHaveBeenLastCalledWith(null);
    pointer(container, 'pointermove', 105);
    expect(hover).toHaveBeenLastCalledWith({ edge: 'left', side: 'prev' });
    target.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'touch', clientX: 790 }));
    expect(hover).toHaveBeenLastCalledWith(null);
    pointer(target, 'pointermove', 790);
    pointer(doc.querySelector('a')!, 'pointermove', 790);
    expect(hover).toHaveBeenLastCalledWith(null);
  });
  it('正文方向键归一化，输入控件、选区与组合键仍交给浏览器', () => {
    const navigation = vi.fn();
    adapter.on('key-navigation', navigation);
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(navigation).toHaveBeenCalledWith({ side: 'next' });
    navigation.mockClear();
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }));
    const input = doc.createElement('input');
    doc.body.append(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    const editable = doc.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    doc.body.append(editable);
    editable.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    const range = doc.createRange();
    range.selectNodeContents(target);
    doc.getSelection()!.addRange(range);
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(navigation).not.toHaveBeenCalled();
  });
  it('销毁会取消待执行点击并解绑 iframe 与容器监听', () => {
    click(target, 790);
    adapter.destroy();
    click(target, 790);
    click(container, 105);
    vi.advanceTimersByTime(500);
    expect(tap).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('已有高亮的问答选区', () => {
  it('通过精确 CFI 提取原 Range，保留原始空白', () => {
    const range = doc.createRange(); range.selectNodeContents(target);
    const internal = adapter as unknown as Internals;
    Object.assign(internal.view as object, { resolveCFI: () => ({ index: 0, anchor: () => range }), book: { sections: [{ id: 'chapter.xhtml' }] } });
    hitTest.mockReturnValue(['epubcfi(/6/2!/4/2)']);
    click(target, 200); vi.advanceTimersByTime(300);
    expect(annotation.mock.calls[0][0].epubSelection).toEqual({ sectionIndex: 0, href: 'chapter.xhtml', cfi: 'epubcfi(/6/2!/4/2)', displayedQuote: target.textContent });
  });
  it('无效 CFI 保留编辑事件并返回明确不可提问原因', () => {
    hitTest.mockReturnValue(['invalid']); click(target, 200); vi.advanceTimersByTime(300);
    expect(annotation.mock.calls[0][0].epubSelection).toBeUndefined();
    expect(annotation.mock.calls[0][0].selectionError).toContain('无法准确定位');
  });
});

describe('precise QA location outline', () => {
  it('draws the resolved CFI range without creating a saved annotation and replaces the previous outline', async () => {
    const range = doc.createRange();
    range.selectNodeContents(target);
    const add = vi.fn(), remove = vi.fn();
    const renderer = { goTo: vi.fn(async () => {}), getContents: () => [{ index: 0, doc, overlayer: { add, remove } }] };
    (adapter as unknown as Internals).view = {
      renderer, resolveNavigation: () => ({ index: 0, anchor: () => range }),
      resolveCFI: () => ({ index: 0, anchor: () => range }), history: { pushState: vi.fn() },
    };
    await adapter.goToLocator({ readerAnchors: { epubcfi: 'epubcfi(test)' } }, { emphasize: true });
    expect(add.mock.calls[0]![1]).toBe(range);
    const shape = add.mock.calls[0]![2]([{ left: 1, top: 2, width: 30, height: 10 }]);
    expect(shape.getAttribute('data-qa-location-outline')).toBe('true');
    expect(shape.querySelector('rect')!.getAttribute('width')).toBe('30');
    await adapter.goToLocator({ readerAnchors: { epubcfi: 'epubcfi(next)' } }, { emphasize: true });
    expect(remove).toHaveBeenCalledWith('foliate-search:qa-focus');
    (adapter as unknown as Internals).view = null;
  });
});

describe('正文触屏选区', () => {
  function select(end: number) {
    const range = doc.createRange();
    range.setStart(target.firstChild!, 0); range.setEnd(target.firstChild!, end);
    const selection = doc.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
    doc.dispatchEvent(new Event('selectionchange'));
  }
  it('无需 mouseup，合并手柄更新并对相同选区去重，保留精确定位', () => {
    const selected = vi.fn(); adapter.on('selection', selected);
    Object.assign((adapter as unknown as Internals).view as object, {
      getCFI: (_index: number, range: Range) => `cfi:${range.endOffset}`,
      book: { sections: [{ id: 'chapter.xhtml' }] },
    });
    select(5); vi.advanceTimersByTime(50); select(8); vi.advanceTimersByTime(100);
    expect(selected).toHaveBeenCalledTimes(1);
    expect(selected.mock.calls[0][0]).toMatchObject({ text: 'Readable', locator: { readerAnchors: { epubcfi: 'cfi:8' } } });
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); vi.advanceTimersByTime(100);
    expect(selected).toHaveBeenCalledTimes(1);
    select(13); vi.advanceTimersByTime(100);
    expect(selected.mock.calls[1][0].text).toBe('Readable text');
  });
  it('工具栏接管焦点前同步提交合并窗口内的最后一次调整', () => {
    const selected = vi.fn(); adapter.on('selection', selected);
    select(8); vi.advanceTimersByTime(100);
    select(14);
    document.dispatchEvent(new PointerEvent('pointerdown'));
    expect(selected.mock.calls[1][0].text).toBe('Readable text');
    doc.getSelection()!.removeAllRanges();
    vi.advanceTimersByTime(100);
    expect(selected).toHaveBeenCalledTimes(2);
  });
  it('取消选区只通知一次，重新选择相同文本可再次提交', () => {
    const selected = vi.fn(), cleared = vi.fn();
    adapter.on('selection', selected); adapter.on('selection-cleared', cleared);
    select(8); vi.advanceTimersByTime(100);
    doc.getSelection()!.removeAllRanges(); doc.dispatchEvent(new Event('selectionchange')); vi.advanceTimersByTime(100);
    expect(cleared).toHaveBeenCalledTimes(1);
    doc.dispatchEvent(new Event('selectionchange')); vi.advanceTimersByTime(100);
    expect(cleared).toHaveBeenCalledTimes(1);
    select(8); vi.advanceTimersByTime(100);
    expect(selected).toHaveBeenCalledTimes(2);
  });
  it('长按选择取消待执行翻页，松手不触发导航', () => {
    click(target, 790); select(8);
    target.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerType: 'touch' }));
    click(target, 790); vi.advanceTimersByTime(400);
    expect(tap).not.toHaveBeenCalled();
  });
  it('显式翻页清除选区和待提交事件', () => {
    const selected = vi.fn(); adapter.on('selection', selected);
    Object.assign((adapter as unknown as Internals).view as object, { goRight: vi.fn() });
    select(8); adapter.next(); vi.advanceTimersByTime(400);
    expect(selected).not.toHaveBeenCalled(); expect(doc.getSelection()!.toString()).toBe('');
  });
  it('卸载章节和销毁均取消迟到的选区事件', () => {
    const selected = vi.fn(); adapter.on('selection', selected);
    select(8); container.remove(); vi.advanceTimersByTime(100);
    expect(selected).not.toHaveBeenCalled();
  });
  it('销毁取消待提交的选区', () => {
    const selected = vi.fn(); adapter.on('selection', selected);
    select(8); adapter.destroy(); vi.advanceTimersByTime(400);
    expect(selected).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});
