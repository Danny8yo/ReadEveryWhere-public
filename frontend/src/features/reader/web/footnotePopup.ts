/**
 * 脚注浮层的纯逻辑助手（无 Vue / 无 DOM 依赖，便于单测）。
 *
 * - `sanitizeFootnoteHtml`：净化脚注 HTML，防 XSS（脚注内容来自书籍，不可信）。
 * - `computePopupPosition`：把浮层就近定位到引用上标附近，并夹紧在视口内。
 */
import sanitizeHtml from 'sanitize-html';

/**
 * 净化脚注 HTML。脚注可能含少量排版标签、链接、图片，但绝不允许脚本/事件处理器。
 * 采用白名单：保留常见文本/结构标签与安全属性，剥离 style/script/iframe/on* 等。
 */
export function sanitizeFootnoteHtml(raw: string): string {
  if (!raw) return '';
  return sanitizeHtml(raw, {
    allowedTags: [
      'p', 'br', 'span', 'div', 'section', 'aside', 'blockquote',
      'b', 'strong', 'i', 'em', 'u', 's', 'small', 'sub', 'sup', 'mark',
      'a', 'cite', 'q', 'abbr', 'code', 'pre', 'ruby', 'rt', 'rp',
      'ul', 'ol', 'li', 'dl', 'dt', 'dd',
      'table', 'thead', 'tbody', 'tr', 'td', 'th',
      'img', 'figure', 'figcaption',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      abbr: ['title'],
      '*': ['lang', 'dir'],
    },
    // 图片可能是 epub blob:/data: 资源；http(s) 也放行，其余协议剥离
    allowedSchemes: ['http', 'https', 'mailto', 'data', 'blob'],
    // 按标签细分协议：<img> 需要 data/blob（epub 内嵌图片）；<a> 收紧到
    // http/https/mailto，剥离 data:text/html 之类的导航/钓鱼向量。
    allowedSchemesByTag: {
      img: ['http', 'https', 'data', 'blob'],
      a: ['http', 'https', 'mailto'],
    },
    // a 标签统一去掉可点导航目标之外的风险；保持纯展示（不带 target/js）
    transformTags: {
      a: (tagName, attribs) => {
        const next: Record<string, string> = {};
        if (attribs.href) {
          next.href = attribs.href;
          next.rel = 'noopener noreferrer';
          if (attribs.title) next.title = attribs.title;
        }
        return { tagName, attribs: next };
      },
    },
  });
}

export interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SizeLike {
  width: number;
  height: number;
}

/**
 * 计算脚注浮层左上角坐标（视口 fixed 定位）。
 * 水平：以引用上标中心对齐浮层中心，夹紧在 [margin, vw-width-margin]。
 * 垂直：优先放在上标下方；下方空间不足则放上方；再不够就贴视口内夹紧。
 */
export function computePopupPosition(
  anchor: RectLike,
  popup: SizeLike,
  viewport: SizeLike,
  margin = 8,
): { x: number; y: number } {
  // ---- 水平 ----
  const maxX = Math.max(margin, viewport.width - popup.width - margin);
  let x = anchor.x + anchor.width / 2 - popup.width / 2;
  x = Math.min(Math.max(margin, x), maxX);

  // ---- 垂直 ----
  const below = anchor.y + anchor.height + margin;
  const spaceBelow = viewport.height - below;
  let y: number;
  if (spaceBelow >= popup.height) {
    y = below; // 下方放得下
  } else {
    const above = anchor.y - margin - popup.height;
    y = above >= margin
      ? above // 上方放得下
      : Math.max(margin, viewport.height - popup.height - margin); // 都不够 → 贴视口内
  }
  return { x, y };
}
