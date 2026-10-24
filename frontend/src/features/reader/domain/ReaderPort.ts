/**
 * ReaderPort —— 阅读器无关的抽象接口层。
 *
 * 设计目标（见 plan 第〇节）：让"具体阅读器引擎"可替换、让"笔记/AI"只依赖
 * 规范化定位与文档模型，而绝不直接依赖 foliate-js。
 *
 * 依赖纪律：只有 `features/reader/web/*` 允许 import `vendor/foliate-js`。
 * 业务层（composables、components、services、AI）一律经由本文件的类型与接口。
 */
// ---------------------------------------------------------------------------
// CanonicalLocator —— 阅读器无关的定位（标注/进度的唯一真相）
// ---------------------------------------------------------------------------
/** W3C 风格的文本引用选择器：精确文本 + 前后缀上下文，用于跨引擎/跨版本重锚定。 */
export interface TextQuoteSelector {
  exact: string;
  prefix?: string;
  suffix?: string;
}
/** 文本位置选择器：章节 index + 章节规范化文本内的字符起止偏移。 */
export interface TextPositionSelector {
  sectionIndex: number;
  start: number;
  end: number;
}
/** PDF 相对矩形（相对页面 0..1）。 */
export interface PdfRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
/**
 * 引擎特定的"快速锚点"缓存——可由 CanonicalLocator 的文本选择器重算，
 * 因此**不是真相**，只是加速器。换引擎/换版本时可能失效并被重锚定覆盖。
 */
export interface ReaderAnchors {
  /** EPUB CFI（foliate/epub.js/readium 通用标准，但非所有引擎支持）。 */
  epubcfi?: string;
  /** PDF：页码（1 起）+ 相对矩形。 */
  pdf?: {
    page: number;
    rects: PdfRect[];
  };
}
/**
 * 规范化定位。标注真相 = textQuote(+textPosition)；进度真相 = fraction；
 * readerAnchors 为可重算缓存。任一字段都可能缺省，消费方需按可用信息降级。
 */
export interface CanonicalLocator {
  /** 阅读进度分数 0..1（进度同步的真相，天然与引擎无关）。 */
  fraction?: number;
  /** 文本引用选择器（标注真相之一）。 */
  textQuote?: TextQuoteSelector;
  /** 文本位置选择器（标注真相之一，依赖文档层规范化文本）。 */
  textPosition?: TextPositionSelector;
  /** 人类可读的章节标签。 */
  chapterLabel?: string;
  /** 引擎特定快速锚点缓存。 */
  readerAnchors?: ReaderAnchors;
}
// ---------------------------------------------------------------------------
// 标注 / 选区 / 事件
// ---------------------------------------------------------------------------
export type AnnotationStyle = "highlight" | "underline" | "squiggly";
/** 交给 ReaderPort 绘制的一条标注。 */
export interface DrawnAnnotation {
  id: string;
  locator: CanonicalLocator;
  style: AnnotationStyle;
  color: string;
  note?: string | null;
}
/** 视口坐标矩形（用于放置浮动工具栏）。 */
export interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** 页码信息（分页模式下由引擎给出）。 */
export interface PageInfo {
  current: number;
  total: number;
}
/** 位置变化事件（对应 foliate 的 relocate）。 */
export interface ReaderRelocateEvent {
  locator: CanonicalLocator;
  /** 当前 section index，只作为 reader focus 提示，后端仍需按 BookScope 校验。 */
  sectionIndex?: number;
  fraction: number;
  page?: PageInfo;
  tocHref?: string | null;
  /** 当前 TOC 条目的标签。引擎已按 section+range 解析好，别再拿 href 反查——
   *  同一文件内靠 fragment 区分的多个章节，去掉 fragment 后会塌成同一个 key。 */
  tocLabel?: string | null;
}
/** 用户选区事件——已由 adapter 转成阅读器无关的 locator（含 textQuote + CFI 缓存）。 */
export interface ReaderSelectionEvent {
  /** Physical EPUB resource and raw quote for strict server validation; never a text-search locator. */
  epubSelection?: {
    sectionIndex: number;
    href: string;
    cfi: string;
    displayedQuote: string;
  };
  text: string;
  locator: CanonicalLocator;
  /** 视口坐标（已换算，供工具栏定位）。 */
  rect: ViewportRect;
  /** 若选区命中已存在标注，给出其引擎锚点（CFI）；消费层据此映射到自己的标注 id。 */
  existingAnchorCfi?: string;
}
/** 章节/文档加载事件。 */
export interface ReaderLoadEvent {
  sectionIndex: number;
}
/** 内容区单击（点击翻页/显隐）。side 已解析好方向（含 RTL）。 */
export interface ReaderTapEvent {
  side: "prev" | "next" | "center" | "body";
}
/** 有效边缘悬停：物理位置用于显示提示，side 已按阅读方向解析。 */
export interface ReaderEdgeHoverEvent {
  edge: "left" | "right";
  side: "prev" | "next";
}
/** 全文搜索命中。 */
export interface ReaderSearchResult {
  locator: CanonicalLocator;
  excerpt: string;
  chapterLabel?: string;
}
export interface ReaderEventMap {
  relocate: ReaderRelocateEvent;
  selection: ReaderSelectionEvent;
  /** 正文选区取消；UI 已打开的笔记草稿继续使用此前的选区快照。 */
  "selection-cleared": undefined;
  /** 内容区单击命中已有标注 → 编辑（优先于翻页/显隐）。 */
  "tap-annotation": {
    anchorCfi: string;
    overlapping?: Array<{ anchorCfi: string; epubSelection?: ReaderSelectionEvent["epubSelection"]; selectionError?: string }>;
    epubSelection?: ReaderSelectionEvent["epubSelection"];
    selectionError?: string;
    rect: ViewportRect;
  };
  /** 内容区单击：边缘、普通正文或取消选区（body）。 */
  tap: ReaderTapEvent;
  /** 鼠标离开边缘、开始选择或命中交互元素时为 null。 */
  "edge-hover": ReaderEdgeHoverEvent | null;
  /** 正文 iframe 内未被输入/选字消费的方向键，与点击区域策略独立。 */
  "key-navigation": {
    side: "prev" | "next";
  };
  load: ReaderLoadEvent;
  /** 章节覆盖层已挂载，可恢复该章节批注。 */
  "overlay-ready": ReaderLoadEvent;
  /**
   * 点击了脚注/尾注/词汇/参考文献引用（EPUB）。
   * adapter 已用引擎解析目标并抽取该条脚注 HTML（`html` 为未净化原文，
   * 消费层渲染前**必须** sanitize）。`rect` 为引用上标在视口中的坐标，供浮层就近定位。
   */
  footnote: FootnoteEvent;
}
/** 脚注/尾注/词汇/参考文献的语义类型（来自 epub:type / ARIA role）。 */
export type FootnoteKind =
  | "footnote"
  | "endnote"
  | "note"
  | "biblioentry"
  | "definition";
/** 脚注引用点击事件载荷。 */
export interface FootnoteEvent {
  /** 已解析的目标 href（引擎相对定位，仅用于调试/去重）。 */
  href: string;
  /** 抽取到的脚注 HTML（**未净化**，UI 渲染前必须 sanitize）。 */
  html: string;
  /** 脚注语义类型（无法判定时为 null）。 */
  type: FootnoteKind | null;
  /** 引用上标在视口中的矩形（浮层就近定位用）。 */
  rect: ViewportRect;
}
export type ReaderEventHandler<K extends keyof ReaderEventMap> = (
  payload: ReaderEventMap[K],
) => void;
// ---------------------------------------------------------------------------
// 打开来源 & 布局设置
// ---------------------------------------------------------------------------
/** 阅读器布局/排版设置（阅读器无关的表达，由 adapter 翻译成引擎属性/CSS）。 */
export interface ReaderLayoutSettings {
  fontSize: number;
  fontFamily: "serif" | "sans-serif" | "system-ui";
  lineSpacing: number;
  justify: boolean;
  flow: "paginated" | "scrolled";
  theme: "light" | "dark" | "sepia";
  marginPx: number;
  gapPercent: number;
  maxColumnCount: number;
  maxInlineSize: number;
}
// ---------------------------------------------------------------------------
// ReaderPort 接口
// ---------------------------------------------------------------------------
/**
 * 阅读器引擎的抽象契约。`FoliateReaderAdapter` 是当前实现；将来更换引擎
 * 只需提供新的实现，消费层与 AI 无需改动。
 */
export interface ReaderPort {
  /** 该引擎当前书是否为固定布局（PDF/漫画）。open 后有效。 */
  readonly isFixedLayout: boolean;
  /** 释放引擎资源。 */
  destroy(): void;
  /** 目录（阅读器无关的树，供 UI 渲染）。 */
  getToc(): TocItem[];
  /** 某 section 所属 TOC 条目的标签；无目录或解析不到时返回 null。 */
  getChapterLabel(sectionIndex: number): string | null;
  // ---- 导航 ----
  goToLocator(loc: CanonicalLocator, options?: { emphasize?: boolean }): Promise<void>;
  goToFraction(fraction: number): Promise<void>;
  goToHref(href: string): Promise<void>;
  goToTextStart(): Promise<void>;
  prev(): void;
  next(): void;
  // ---- 排版/样式 ----
  applyLayout(settings: ReaderLayoutSettings): void;
  // ---- 标注 ----
  drawAnnotation(a: DrawnAnnotation): void;
  eraseAnnotation(loc: CanonicalLocator): void;
  // ---- 搜索（可选）----
  /** onProgress: 整书搜索进度 0..1（逐章推进），供 UI 显示"搜索中 XX%"。 */
  search?(
    query: string,
    onProgress?: (progress: number) => void,
  ): AsyncIterable<ReaderSearchResult>;
  /** 清除搜索命中的临时高亮（可选）。 */
  clearSearch?(): void;
  // ---- 事件 ----
  on<K extends keyof ReaderEventMap>(
    event: K,
    handler: ReaderEventHandler<K>,
  ): void;
  off<K extends keyof ReaderEventMap>(
    event: K,
    handler: ReaderEventHandler<K>,
  ): void;
}
/** 阅读器无关的目录项。 */
export interface TocItem {
  label: string;
  href: string;
  subitems?: TocItem[];
}
