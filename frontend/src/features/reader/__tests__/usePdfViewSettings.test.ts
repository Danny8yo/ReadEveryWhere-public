import { beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import { usePdfViewSettings } from '../web/usePdfViewSettings';

// 简易 localStorage stub（node 环境无此全局）
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

beforeEach(() => {
  (globalThis as any).localStorage = new MemStorage();
});

const BOOK = 42;
const key = `readEveryWhere.pdfView.${BOOK}`;

describe('usePdfViewSettings', () => {
  it('falls back to fit-width / single page when nothing is stored', () => {
    const { pdfView } = usePdfViewSettings(BOOK);
    expect(pdfView).toMatchObject({ layout: 'single', zoom: 'fit-width', zoomPercent: 100 });
  });

  it('restores a stored zoom and layout', () => {
    localStorage.setItem(key, JSON.stringify({ layout: 'double', zoom: 1.2, zoomPercent: 120 }));
    const { pdfView } = usePdfViewSettings(BOOK);
    expect(pdfView).toMatchObject({ layout: 'double', zoom: 1.2, zoomPercent: 120 });
  });

  it('persists changes so the next open picks them up', async () => {
    const { pdfView } = usePdfViewSettings(BOOK);
    pdfView.zoom = 1.2;
    pdfView.zoomPercent = 120;
    await nextTick();

    const { pdfView: reopened } = usePdfViewSettings(BOOK);
    expect(reopened).toMatchObject({ zoom: 1.2, zoomPercent: 120 });
  });

  it('keeps books independent', async () => {
    const { pdfView } = usePdfViewSettings(BOOK);
    pdfView.zoomPercent = 200;
    pdfView.zoom = 2;
    await nextTick();

    const { pdfView: other } = usePdfViewSettings(7);
    expect(other).toMatchObject({ zoom: 'fit-width', zoomPercent: 100 });
  });

  it('clamps an out-of-range stored zoom instead of trusting it', () => {
    localStorage.setItem(key, JSON.stringify({ layout: 'single', zoom: 99, zoomPercent: 9900 }));
    const { pdfView } = usePdfViewSettings(BOOK);
    expect(pdfView.zoom).toBe(3); // 300% ceiling
    expect(pdfView.zoomPercent).toBe(300);
  });

  it('falls back to defaults on corrupt json', () => {
    localStorage.setItem(key, '{not json');
    const { pdfView } = usePdfViewSettings(BOOK);
    expect(pdfView).toMatchObject({ layout: 'single', zoom: 'fit-width', zoomPercent: 100 });
  });
});
