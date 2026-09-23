// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { FoliateReaderAdapter } from '../lib/reader/adapters/FoliateReaderAdapter';

type ResolvedTarget = { index: number; anchor?: (doc: Document) => unknown };

function createAdapter(resolveNavigation: (target: string | number) => unknown) {
  const goTo = vi.fn().mockResolvedValue(undefined);
  const pushState = vi.fn();
  const adapter = new FoliateReaderAdapter();

  (adapter as unknown as { view: unknown }).view = {
    resolveNavigation,
    renderer: { goTo },
    history: { pushState },
  };

  return { adapter, goTo, pushState };
}

describe('FoliateReaderAdapter 目录导航', () => {
  it('支持 EPUB/MOBI6 的同步 href 解析', async () => {
    const resolved: ResolvedTarget = { index: 2 };
    const resolveNavigation = vi.fn().mockReturnValue(resolved);
    const { adapter, goTo, pushState } = createAdapter(resolveNavigation);

    await adapter.goToHref('chapter-3.xhtml');

    expect(resolveNavigation).toHaveBeenCalledWith('chapter-3.xhtml');
    expect(goTo).toHaveBeenCalledWith(resolved);
    expect(pushState).toHaveBeenCalledWith('chapter-3.xhtml');
  });

  it('等待 PDF/KF8 的异步 href 解析后再跳转', async () => {
    const resolved: ResolvedTarget = { index: 7 };
    const resolveNavigation = vi.fn().mockResolvedValue(resolved);
    const { adapter, goTo, pushState } = createAdapter(resolveNavigation);

    await adapter.goToHref('async-chapter-target');

    expect(resolveNavigation).toHaveBeenCalledWith('async-chapter-target');
    expect(goTo).toHaveBeenCalledWith(resolved);
    expect(pushState).toHaveBeenCalledWith('async-chapter-target');
  });

  it('异步 href 解析失败时向调用方传播错误且不记录历史', async () => {
    const resolveError = new Error('PDF_DESTINATION_NOT_FOUND');
    const { adapter, goTo, pushState } = createAdapter(
      vi.fn().mockRejectedValue(resolveError),
    );

    await expect(adapter.goToHref('missing-destination')).rejects.toBe(resolveError);
    expect(goTo).not.toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();
  });

  it('拒绝缺少有效数字 index 的解析结果', async () => {
    const { adapter, goTo, pushState } = createAdapter(
      vi.fn().mockResolvedValue({ index: '7' }),
    );

    await expect(adapter.goToHref('invalid-target')).rejects.toThrow(
      'NAVIGATION_TARGET_NOT_FOUND',
    );
    expect(goTo).not.toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();
  });
});
