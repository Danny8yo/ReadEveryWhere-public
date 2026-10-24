import { describe, expect, it } from 'vitest';
import { sanitizeFootnoteHtml, computePopupPosition } from '../web/footnotePopup';

describe('sanitizeFootnoteHtml', () => {
  it('returns empty string for empty input', () => {
    expect(sanitizeFootnoteHtml('')).toBe('');
  });

  it('keeps safe inline/structural markup', () => {
    const out = sanitizeFootnoteHtml('<p>见 <em>第一章</em> 与 <strong>注解</strong>。</p>');
    expect(out).toBe('<p>见 <em>第一章</em> 与 <strong>注解</strong>。</p>');
  });

  it('strips <script> and event handlers (XSS)', () => {
    const out = sanitizeFootnoteHtml(
      '<p onclick="steal()">hi</p><script>alert(1)</script>',
    );
    expect(out).not.toContain('script');
    expect(out).not.toContain('onclick');
    expect(out).toContain('hi');
  });

  it('drops javascript: hrefs but keeps http links with rel', () => {
    const evil = sanitizeFootnoteHtml('<a href="javascript:alert(1)">x</a>');
    expect(evil).not.toContain('javascript:');

    const ok = sanitizeFootnoteHtml('<a href="https://example.com">x</a>');
    expect(ok).toContain('href="https://example.com"');
    expect(ok).toContain('rel="noopener noreferrer"');
  });

  it('removes style/iframe and disallowed tags', () => {
    const out = sanitizeFootnoteHtml('<iframe src="x"></iframe><style>*{}</style><b>keep</b>');
    expect(out).not.toContain('iframe');
    expect(out).not.toContain('style');
    expect(out).toContain('<b>keep</b>');
  });
});

describe('computePopupPosition', () => {
  const viewport = { width: 1000, height: 800 };
  const popup = { width: 360, height: 200 };

  it('places below the anchor and centers horizontally when space allows', () => {
    const anchor = { x: 400, y: 100, width: 20, height: 16 };
    const pos = computePopupPosition(anchor, popup, viewport);
    // centered: 400 + 10 - 180 = 230
    expect(pos.x).toBe(230);
    // below: 100 + 16 + 8 = 124
    expect(pos.y).toBe(124);
  });

  it('clamps horizontally at the right edge', () => {
    const anchor = { x: 980, y: 100, width: 10, height: 16 };
    const pos = computePopupPosition(anchor, popup, viewport);
    // maxX = 1000 - 360 - 8 = 632
    expect(pos.x).toBe(632);
  });

  it('clamps horizontally at the left edge', () => {
    const anchor = { x: 0, y: 100, width: 10, height: 16 };
    const pos = computePopupPosition(anchor, popup, viewport);
    expect(pos.x).toBe(8);
  });

  it('flips above the anchor when there is no room below', () => {
    const anchor = { x: 400, y: 700, width: 20, height: 16 };
    const pos = computePopupPosition(anchor, popup, viewport);
    // spaceBelow = 800 - (700+16+8) = 76 < 200 → above: 700 - 8 - 200 = 492
    expect(pos.y).toBe(492);
  });

  it('pins inside the viewport when neither above nor below fits', () => {
    const tallPopup = { width: 360, height: 780 };
    const anchor = { x: 400, y: 400, width: 20, height: 16 };
    const pos = computePopupPosition(anchor, tallPopup, viewport);
    // above would be 400-8-780 < 8 → pin: max(8, 800-780-8)=12
    expect(pos.y).toBe(12);
  });
});
