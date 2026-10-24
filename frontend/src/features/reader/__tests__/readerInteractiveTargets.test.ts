// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { FoliateReaderAdapter } from '../web/adapters/FoliateReaderAdapter';

describe('正文交互目标', () => {
  const adapter = new FoliateReaderAdapter() as unknown as {
    isInteractive(target: Element): boolean;
  };
  it.each([
    ['<a id="chapter"><span>章节标题</span></a>', false],
    ['<sup><span>普通上标</span></sup>', false],
    ['<a href="#note"><sup><span>脚注</span></sup></a>', true],
    ['<a href="https://example.com"><span>链接</span></a>', true],
    ['<button><span>按钮</span></button>', true],
    ['<div contenteditable="true"><span>编辑内容</span></div>', true],
  ])('%s 的交互拦截为 %s', (html, expected) => {
    const root = document.createElement('div');
    root.innerHTML = html;
    expect(adapter.isInteractive(root.querySelector('span')!)).toBe(expected);
  });
});
