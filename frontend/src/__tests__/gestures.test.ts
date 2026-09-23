import { describe, expect, it } from 'vitest';
import { edgeTapWidth, resolveTapSide, toRelativeX } from '../features/reader/domain/gestures';

describe('阅读器热区', () => {
  it('使用容器坐标并拒绝无效宽度', () => {
    expect(toRelativeX(300, 100, 400)).toBe(0.5);
    expect(toRelativeX(300, 100, 0)).toBeNull();
    expect(toRelativeX(300, 100, -10)).toBeNull();
  });
  it.each([[200, 40], [600, 60], [1200, 80]])('宽度 %i 的边缘为 %i px', (width, edge) => {
    expect(edgeTapWidth(width)).toBe(edge);
    expect(resolveTapSide(edge / width, false, width)).toBe('prev');
    expect(resolveTapSide((edge + 1) / width, false, width)).toBe('center');
    expect(resolveTapSide(1 - edge / width, false, width)).toBe('next');
    expect(resolveTapSide(1 - (edge + 1) / width, false, width)).toBe('center');
  });
  it('非边缘正文均可显隐，容器外无动作', () => {
    for (const x of [0.1, 0.25, 0.375, 0.5, 0.625, 0.75, 0.9]) expect(resolveTapSide(x, false, 1200)).toBe('center');
    for (const x of [-0.1, 1.1, NaN]) {
      expect(resolveTapSide(x, false, 1200)).toBe('body');
    }
  });
  it('RTL 只反转边缘方向', () => {
    expect(resolveTapSide(0, true, 1200)).toBe('next');
    expect(resolveTapSide(1, true, 1200)).toBe('prev');
    expect(resolveTapSide(0.5, true, 1200)).toBe('center');
    expect(resolveTapSide(0.2, true, 1200)).toBe('center');
  });
});
