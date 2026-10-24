/**
 * 阅读器样式生成（对应 readest utils/style.ts 的核心子集，自行重写）。
 *
 * 通过 `renderer.setStyles(getStyles(...))` 注入到每个章节 iframe，实现：
 * - 正规主题色（深底浅字，而非 filter:invert 反色；图片不被反色）
 * - 字号/字体/行距/两端对齐
 * - 页边距/栏宽（配合 renderer 属性）
 */
import type { ReaderLayoutSettings } from '../domain/ReaderPort';

import type { ThemePalette } from '../domain/themes';

const FONT_STACKS: Record<ReaderLayoutSettings['fontFamily'], string> = {
  serif: 'Georgia, "Times New Roman", "Noto Serif SC", serif',
  'sans-serif': 'Inter, system-ui, "Noto Sans SC", sans-serif',
  'system-ui': 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
};

function getFontStyles(s: ReaderLayoutSettings): string {
  return `
    html {
      font-size: ${s.fontSize}px !important;
    }
    html, body {
      font-family: ${FONT_STACKS[s.fontFamily]};
    }
  `;
}

/**
 * 正规颜色注入。关键点：设置 color-scheme + 背景/前景变量，并把书内硬编码的
 * 纯黑文字（font[color]/内联 color:#000）覆盖为主题前景色，避免暗色下"黑字黑底"。
 */
function getColorStyles(t: ThemePalette): string {
  return `
    html {
      --theme-bg-color: ${t.bg};
      --theme-fg-color: ${t.fg};
      color-scheme: ${t.isDarkMode ? 'dark' : 'light'};
      background-color: var(--theme-bg-color) !important;
    }
    html, body {
      color: var(--theme-fg-color) !important;
      background-color: transparent !important;
    }
    /* 覆盖书内硬编码的黑色文字，避免暗色下不可读 */
    body [style*="color:#000"],
    body [style*="color: #000"],
    body [style*="color:black"],
    body font[color="#000000"],
    body font[color="black"] {
      color: var(--theme-fg-color) !important;
    }
    a, a * { color: ${t.primary} !important; }
  `;
}

function getParagraphStyles(s: ReaderLayoutSettings): string {
  return `
    html, body {
      writing-mode: horizontal-tb !important;
      margin: 0 !important;
      padding: 0 !important;
      widows: 2;
      orphans: 2;
    }
    /* 书内样式常用类选择器写死行距（如 calibre 的 .calibre { line-height: 1.5 }），
       优先级高于这里的元素选择器，不加 !important 用户调行距就不生效。
       标题不跟正文行距：给个不带 !important 的默认值，书内给标题写了行距仍以书为准 */
    html, body, p, li, blockquote, dd, div {
      line-height: ${s.lineSpacing} !important;
    }
    h1, h2, h3, h4, h5, h6 {
      line-height: 1.3;
    }
    p, li, blockquote, dd {
      text-align: ${s.justify ? 'justify' : 'start'};
      hyphens: ${s.justify ? 'auto' : 'manual'};
    }
    [align="left"] { text-align: left; }
    [align="right"] { text-align: right; }
    [align="center"] { text-align: center; }
    [align="justify"] { text-align: justify; }
    pre { white-space: pre-wrap !important; }
    img, svg, video { max-width: 100% !important; height: auto !important; }
  `;
}

/** 拼接完整的注入样式表。 */
export function getStyles(settings: ReaderLayoutSettings, theme: ThemePalette): string {
  return [
    getFontStyles(settings),
    getColorStyles(theme),
    getParagraphStyles(settings),
  ].join('\n');
}

/** 在章节 iframe document 的 body 上标注主题模式，供书内主题相关 CSS 钩子使用。 */
export function applyThemeModeClass(doc: Document, isDarkMode: boolean): void {
  const body = doc.body;
  if (!body) return;
  body.classList.toggle('theme-dark', isDarkMode);
  body.classList.toggle('theme-light', !isDarkMode);
}
