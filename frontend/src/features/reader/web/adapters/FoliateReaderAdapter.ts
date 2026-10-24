import { bindReaderDocumentInteractions } from './reader-document-interactions';
/**
 * FoliateReaderAdapter —— 用 foliate-js 实现 ReaderPort。
 *
 * 直接消费 vendor/foliate-js 的 Web 适配器；engineHost 同样可装配目录 UI。
 * 换引擎时实现 ReaderPort/WebReaderPort，业务 UI 不依赖 Foliate 原始对象。
 */
import { makeBook } from "../../../../vendor/foliate-js/view.js";
import "../../../../vendor/foliate-js/view.js";
import { Overlayer } from "../../../../vendor/foliate-js/overlayer.js";
import type {
  AnnotationStyle,
  CanonicalLocator,
  DrawnAnnotation,
  FootnoteKind,
  ReaderEventHandler,
  ReaderEventMap,
  ReaderEdgeHoverEvent,
  ReaderLayoutSettings,
  ReaderSearchResult,
  TextQuoteSelector,
  TocItem,
  ViewportRect,
} from "../../domain/ReaderPort";
import type {
  ReaderOpenOptions,
  ReaderSource,
  WebReaderPort as ReaderPort,
} from "../WebReaderPort";

import { getStyles, applyThemeModeClass } from "../style";
import { getThemeCode } from "../../domain/themes";
import { extractTextQuote, findTextPosition } from "../anchoring";
import {
  resolveTapSide,
  toRelativeX,
} from "../../domain/gestures";
import { relocateSectionIndex } from "../../domain/relocate";

type OverlayerDraw = (rects: DOMRect[], options: unknown) => SVGElement;

const OVERLAYER_DRAW: Record<AnnotationStyle, OverlayerDraw> = {
  highlight: Overlayer.highlight,
  underline: Overlayer.underline,
  squiggly: Overlayer.squiggly,
};

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * "此处有备注"的气泡标记，画在批注末尾。
 *
 * 必须挂在基础图形之外：Overlayer.highlight 会给自己的 <g> 设 opacity .35 +
 * mix-blend-mode: multiply，标记若挂在里面就会一起被冲淡到看不见——同色的圆点
 * 落在同色高亮上，正是"只看得到高亮、看不出有没有备注"的原因。
 */
function createNoteMarker(rects: DOMRect[], color: string): SVGElement | null {
  const last = rects[rects.length - 1];
  if (!last) return null;

  const w = 12;
  const h = 10;
  const x = last.right + 4;
  const y = last.top + last.height / 2 - h / 2;

  const marker = document.createElementNS(SVG_NS, "path");
  // 圆角气泡 + 左下角小尾巴
  marker.setAttribute(
    "d",
    [
      `M${x + 2} ${y}`,
      `h${w - 4}`,
      `a2 2 0 0 1 2 2`,
      `v${h - 4}`,
      `a2 2 0 0 1 -2 2`,
      `h${-(w - 6)}`,
      `l-3 3`,
      `v-3`,
      `a2 2 0 0 1 -2 -2`,
      `v${-(h - 4)}`,
      `a2 2 0 0 1 2 -2`,
      "z",
    ].join(" "),
  );
  marker.setAttribute("fill", color);
  // 描边保证在浅色高亮/浅色纸面上仍有轮廓（黄底黄点否则等于隐形）
  marker.setAttribute("stroke", "rgba(0, 0, 0, 0.45)");
  marker.setAttribute("stroke-width", "1");
  marker.setAttribute("stroke-linejoin", "round");
  return marker;
}

/** 把 iframe 内的 rect 换算成视口坐标（分页模式下 iframe 很宽，坐标需换算）。 */
function toViewportRect(
  doc: Document | undefined,
  rect: DOMRect,
): ViewportRect {
  const iframeEl = doc?.defaultView?.frameElement as HTMLElement | null;
  const iframeRect = iframeEl?.getBoundingClientRect();
  return {
    x: (iframeRect?.left ?? 0) + rect.left,
    y: (iframeRect?.top ?? 0) + rect.top,
    width: rect.width,
    height: rect.height,
  };
}

// ---------------------------------------------------------------------------
// 脚注检测 / 抽取（逻辑对齐 foliate-js/footnotes.js，MIT；此处不走其 mini-view，
// 而是直接用 book.resolveHref + section.createDocument 抽 HTML 交给浮层展示）。
// ---------------------------------------------------------------------------
const EPUB_TYPE_NS = "http://www.idpf.org/2007/ops";
const getEpubTypes = (el: Element | null): Set<string> =>
  new Set(el?.getAttributeNS?.(EPUB_TYPE_NS, "type")?.split(/\s+/) ?? []);
const getRoles = (el: Element | null): Set<string> =>
  new Set(el?.getAttribute?.("role")?.split(/\s+/) ?? []);

const REF_TYPES = ["biblioref", "glossref", "noteref"];
const REF_ROLES = ["doc-biblioref", "doc-glossref", "doc-noteref"];

/** 元素在视觉上是否为上标（脚注引用常见形态）。 */
function isSuper(el: Element): boolean {
  if (el.matches("sup")) return true;
  const win = el.ownerDocument?.defaultView ?? globalThis;
  const va = win.getComputedStyle(el).verticalAlign;
  return va === "super" || va === "top" || va === "text-top" || /^\d/.test(va);
}

/**
 * 判定一个链接是否为脚注引用。
 * `yes`：显式 epub:type / ARIA role 命中（noteref/biblioref/glossref）。
 * `maybe`：无显式标注但呈上标形态（排除 backlink 回跳链接）——按 foliate 启发式兜底。
 */
function classifyFootnoteRef(a: Element): { yes: boolean; maybe: boolean } {
  const types = getEpubTypes(a);
  const roles = getRoles(a);
  const yes =
    REF_ROLES.some((r) => roles.has(r)) || REF_TYPES.some((t) => types.has(t));
  const notBacklink = !types.has("backlink") && !roles.has("doc-backlink");
  const superish =
    isSuper(a) ||
    (a.children.length === 1 && isSuper(a.children[0])) ||
    (a.parentElement ? isSuper(a.parentElement) : false);
  return { yes, maybe: notBacklink && superish };
}

/** 依 epub:type / role 归类脚注语义类型。 */
function referencedType(el: Element | null): FootnoteKind | null {
  const types = getEpubTypes(el);
  const roles = getRoles(el);
  if (roles.has("doc-biblioentry") || types.has("biblioentry"))
    return "biblioentry";
  if (roles.has("definition") || types.has("glossdef")) return "definition";
  if (roles.has("doc-endnote") || types.has("endnote") || types.has("rearnote"))
    return "endnote";
  if (roles.has("doc-footnote") || types.has("footnote")) return "footnote";
  if (roles.has("note") || types.has("note")) return "note";
  return null;
}

const INLINE_SEL = "a, span, sup, sub, em, strong, i, b, small, big";
/** 由锚点元素向上找到承载脚注正文的块级元素（对齐 foliate 的 extractFootnote）。 */
function extractFootnoteBlock(
  doc: Document,
  anchorEl: Element,
): Element | null {
  let el: Element = anchorEl;
  const target = el;
  while (el.matches(INLINE_SEL)) {
    const parent = el.parentElement;
    if (!parent) break;
    el = parent;
  }
  if (el === doc.body) {
    const sibling = target.nextElementSibling;
    if (sibling && !sibling.matches(INLINE_SEL)) return sibling;
    return null;
  }
  return el;
}

/** 抽取脚注块的 HTML，并剥离回跳（backlink）链接。返回未净化 HTML。 */
function footnoteHtml(block: Element): string {
  const clone = block.cloneNode(true) as Element;
  clone.querySelectorAll("a").forEach((anchor) => {
    if (
      getEpubTypes(anchor).has("backlink") ||
      getRoles(anchor).has("doc-backlink")
    ) {
      anchor.remove();
    }
  });
  // li/aside：只取内容（对齐 selectNodeContents）；其余取整个元素（对齐 selectNode）
  return clone.matches("li, aside") ? clone.innerHTML : clone.outerHTML;
}

/** foliate 搜索摘要是 { pre, match, post } 对象；拼成字符串供 UI 展示。 */
function excerptToString(ex: any): string {
  if (ex == null) return "";
  if (typeof ex === "string") return ex;
  return `${ex.pre ?? ""}${ex.match ?? ""}${ex.post ?? ""}`;
}

function mapToc(items: any[] | undefined): TocItem[] {
  if (!items?.length) return [];
  return items.map((it) => ({
    label: it.label ?? it.title ?? "",
    href: it.href ?? "",
    subitems: it.subitems ? mapToc(it.subitems) : undefined,
  }));
}

export class FoliateReaderAdapter implements ReaderPort {
  private focusCfi: string | null = null;
  private readonly focusKey = "foliate-search:qa-focus";
  private clearFocus(): void {
    if (!this.focusCfi) return;
    for (const content of this.view.renderer.getContents()) content.overlayer?.remove(this.focusKey);
    this.focusCfi = null;
  }
  private drawFocus(): void {
    if (!this.focusCfi) return;
    const resolved = this.view.resolveCFI(this.focusCfi);
    const content = this.view.renderer.getContents().find((item: { index: number }) => item.index === resolved.index);
    if (!content?.overlayer) return;
    const range = resolved.anchor(content.doc);
    if (range.collapsed) throw new Error("QA_LOCATION_RANGE_EMPTY");
    content.overlayer.add(this.focusKey, range, (rects: DOMRect[]) => {
      const shape = Overlayer.outline(rects, { color: "#e22", width: 2, radius: 3 });
      shape.setAttribute("data-qa-location-outline", "true");
      return shape;
    });
  }
  private view: any = null;
  private container: HTMLElement | null = null;
  private layout: ReaderLayoutSettings | null = null;
  private _isFixedLayout = false;
  private _rtl = false;
  private listeners: Record<string, Set<(payload: any) => void>> = {};
  private boundDocs = new Map<Document, () => void>();
  private selectionResetters = new Set<() => void>();
  private unbindContainer: (() => void) | null = null;
  private edgeHover: ReaderEdgeHoverEvent | null = null;
  private pointerStart: { x: number; y: number } | null = null;
  private suppressClick = false;
  private clearingSelection = false;
  /** 单击延迟计时器：双击（选词）到达时取消，避免误触发翻页/显隐。 */
  private tapTimer: number | null = null;

  get isFixedLayout(): boolean {
    return this._isFixedLayout;
  }

  /**
   * 受控的原始 foliate view 访问口。**仅供同目录的 PDF 自绘标注层使用**，
   * 其余业务代码禁止调用（PDF 可移植性将在后续阶段硬化）。
   */
  get rawView(): any {
    return this.view;
  }

  // ---- 事件 ----
  on<K extends keyof ReaderEventMap>(
    event: K,
    handler: ReaderEventHandler<K>,
  ): void {
    (this.listeners[event] ??= new Set()).add(handler as (p: any) => void);
  }
  off<K extends keyof ReaderEventMap>(
    event: K,
    handler: ReaderEventHandler<K>,
  ): void {
    this.listeners[event]?.delete(handler as (p: any) => void);
  }
  private emit<K extends keyof ReaderEventMap>(
    event: K,
    payload: ReaderEventMap[K],
  ): void {
    this.listeners[event]?.forEach((h) => {
      try {
        h(payload);
      } catch (e) {
        console.error(`[ReaderPort] listener for "${event}" threw`, e);
      }
    });
  }

  // ---- 生命周期 ----
  async open(
    source: ReaderSource,
    container: HTMLElement,
    opts?: ReaderOpenOptions,
  ): Promise<void> {
    this.container = container;
    const book =
      source.kind === "file"
        ? await makeBook(source.file)
        : await makeBook(source.url);
    opts?.prepareBook?.(book);

    this.view = document.createElement("foliate-view");
    container.append(this.view);
    await this.view.open(book);

    this._isFixedLayout =
      !!this.view.isFixedLayout || book?.rendition?.layout === "pre-paginated";
    this._rtl = this.view.book?.dir === "rtl";

    // 重排式书籍的开书常量（分页动画、上限）；PDF/固定布局由消费层经 rawView 处理
    if (!this._isFixedLayout && this.view.renderer) {
      this.view.renderer.setAttribute("max-block-size", "8000px");
      this.view.renderer.setAttribute("animated", "");
    }

    this.view.addEventListener("relocate", this.onRelocate);
    this.view.addEventListener("load", this.onLoad);
    this.view.addEventListener("unload", this.onUnload);
    this.view.addEventListener("create-overlay", this.onCreateOverlay);
    this.view.addEventListener("draw-annotation", this.onDrawAnnotation);
    this.view.addEventListener("link", this.onLink);
    this.unbindContainer = this.bindInteraction(container, null);
  }

  destroy(): void {
    this.unbindContainer?.();
    this.unbindContainer = null;
    for (const unbind of this.boundDocs.values()) unbind();
    this.boundDocs.clear();
    this.pointerStart = null;
    this.setEdgeHover(null);
    if (this.tapTimer !== null) {
      clearTimeout(this.tapTimer);
      this.tapTimer = null;
    }
    if (!this.view) return;
    this.clearFocus();
    this.view.removeEventListener("relocate", this.onRelocate);
    this.view.removeEventListener("load", this.onLoad);
    this.view.removeEventListener("unload", this.onUnload);
    this.view.removeEventListener("create-overlay", this.onCreateOverlay);
    this.view.removeEventListener("draw-annotation", this.onDrawAnnotation);
    this.view.removeEventListener("link", this.onLink);
    try {
      this.view.close();
    } catch {
      /* ignore */
    }
    this.view.remove();
    this.view = null;
    this.container = null;
    this.listeners = {};
  }

  getToc(): TocItem[] {
    return mapToc(this.view?.book?.toc);
  }

  getChapterLabel(sectionIndex: number): string | null {
    try {
      return this.view?.getProgressOf?.(sectionIndex)?.tocItem?.label ?? null;
    } catch {
      return null;
    }
  }

  /** PDF 总页数（PDF 专用；EPUB 返回 0）。 */
  getSectionCount(): number {
    return this.view?.book?.sections?.length ?? 0;
  }

  private clearSelectionForNavigation(): void {
    for (const reset of this.selectionResetters) reset();
  }

  // ---- 导航 ----
  async goToLocator(loc: CanonicalLocator, options?: { emphasize?: boolean }): Promise<void> {
    this.clearSelectionForNavigation();
    this.clearFocus();
    const cfi = loc.readerAnchors?.epubcfi;
    if (options?.emphasize) {
      if (!cfi) throw new Error("QA_LOCATION_CFI_REQUIRED");
      await this.goToResolvedTarget(cfi);
      this.focusCfi = cfi;
      this.drawFocus();
      return;
    }
    if (cfi) {
      try {
        await this.goToResolvedTarget(cfi);
        return;
      } catch {
        /* CFI 失效 —— 交给上层用文本重锚定后再定位 */
      }
    }
    if (
      loc.textQuote &&
      loc.textPosition &&
      loc.textPosition.sectionIndex >= 0
    ) {
      const sectionIndex = loc.textPosition.sectionIndex;
      await this.goToResolvedTarget(sectionIndex);
      const range = this.rangeFromQuote(sectionIndex, loc.textQuote);
      if (!range) throw new Error("TEXT_QUOTE_NOT_FOUND");
      const reanchoredCfi = this.view?.getCFI?.(sectionIndex, range);
      if (!reanchoredCfi) throw new Error("TEXT_QUOTE_REANCHOR_FAILED");
      await this.goToResolvedTarget(reanchoredCfi);
      return;
    }
    if (typeof loc.fraction === "number" && loc.fraction > 0) {
      await this.view.goToFraction(loc.fraction);
      return;
    }
    if (cfi || loc.textQuote || loc.textPosition) {
      throw new Error("LOCATOR_NOT_RESOLVED");
    }
    await this.goToTextStart();
  }
  async goToFraction(fraction: number): Promise<void> {
    this.clearSelectionForNavigation();
    await this.view.goToFraction(fraction);
  }
  async goToHref(href: string): Promise<void> {
    this.clearSelectionForNavigation();
    await this.goToResolvedTarget(href);
  }
  async goToTextStart(): Promise<void> {
    this.clearSelectionForNavigation();
    await this.view.goToTextStart();
  }
  prev(): void {
    this.clearSelectionForNavigation();
    if (!this._isFixedLayout && this.view?.renderer?.prev)
      this.view.renderer.prev();
    else this.view?.goLeft();
  }
  next(): void {
    this.clearSelectionForNavigation();
    if (!this._isFixedLayout && this.view?.renderer?.next)
      this.view.renderer.next();
    else this.view?.goRight();
  }

  /** 绕开 foliate view.goTo 的吞错行为，让上层能可靠执行 Citation 降级。 */
  private async goToResolvedTarget(target: string | number): Promise<void> {
    const resolved = await this.view?.resolveNavigation?.(target);
    if (!resolved || typeof resolved.index !== "number")
      throw new Error("NAVIGATION_TARGET_NOT_FOUND");
    await this.view.renderer.goTo(resolved);
    this.view.history?.pushState?.(target);
  }

  // ---- 排版 ----
  applyLayout(settings: ReaderLayoutSettings): void {
    this.layout = settings;
    const renderer = this.view?.renderer;
    if (!renderer || this._isFixedLayout) return;
    const themeCode = getThemeCode(settings.theme);
    renderer.setAttribute("flow", settings.flow);
    renderer.setAttribute("gap", `${settings.gapPercent}%`);
    renderer.setAttribute("margin", `${settings.marginPx}px`);
    renderer.setAttribute("max-inline-size", `${settings.maxInlineSize}px`);
    renderer.setAttribute("max-column-count", String(settings.maxColumnCount));
    renderer.setStyles?.(getStyles(settings, themeCode));
    // 页面周边留白跟随主题；已加载章节即时套用主题模式类
    this.view.style?.setProperty("--view-bg", themeCode.bg);
    for (const { doc } of renderer.getContents?.() ?? []) {
      if (doc) applyThemeModeClass(doc, themeCode.isDarkMode);
    }
  }

  // ---- 标注（EPUB）----
  drawAnnotation(a: DrawnAnnotation): void {
    const draw = OVERLAYER_DRAW[a.style];
    if (!draw) return;
    let cfi = a.locator.readerAnchors?.epubcfi;
    // CFI 缺失/失效 → 用 TextQuote 在对应章节重锚定（换引擎/换版本不丢笔记）
    if (!cfi && a.locator.textQuote && a.locator.textPosition) {
      const range = this.rangeFromQuote(
        a.locator.textPosition.sectionIndex,
        a.locator.textQuote,
      );
      if (range)
        cfi =
          this.view?.getCFI?.(a.locator.textPosition.sectionIndex, range) ??
          undefined;
    }
    if (!cfi) return;
    this.view.addAnnotation({
      value: cfi,
      annotationType: a.style,
      color: a.color,
      draw,
      drawOptions: { color: a.color, width: 2 },
      note: a.note,
    });
  }
  eraseAnnotation(loc: CanonicalLocator): void {
    const cfi = loc.readerAnchors?.epubcfi;
    if (!cfi) return;
    try {
      this.view.deleteAnnotation({ value: cfi });
    } catch {
      /* ignore */
    }
  }

  // ---- 搜索 ----
  // foliate 的 view.search（整书）按章节迭代，yield 三种形态：
  //   { progress }                     —— 搜索进度（忽略）
  //   { label, subitems:[{cfi,excerpt}] } —— 某章命中，label 为该章 TOC 标签
  //   'done'                            —— 结束
  // 单章搜索（我们不用）才会 yield 顶层 { cfi, excerpt }。此处两种都兜住，
  // 并把 label 作为 chapterLabel 带出（方案 B，近乎零成本）。
  async *search(
    query: string,
    onProgress?: (progress: number) => void,
  ): AsyncIterable<ReaderSearchResult> {
    if (!this.view?.search) return;
    for await (const result of this.view.search({ query })) {
      // foliate 整书搜索逐章 yield { progress }（0..1）——转成进度回调，供 UI 显示
      if (typeof result?.progress === "number") {
        onProgress?.(result.progress);
        continue;
      }
      if (result?.subitems) {
        const chapterLabel: string = result.label ?? "";
        for (const sub of result.subitems) {
          if (!sub?.cfi) continue;
          yield {
            locator: { readerAnchors: { epubcfi: sub.cfi } },
            excerpt: excerptToString(sub.excerpt),
            chapterLabel,
          };
        }
      } else if (result?.cfi) {
        yield {
          locator: { readerAnchors: { epubcfi: result.cfi } },
          excerpt: excerptToString(result.excerpt),
          chapterLabel: "",
        };
      }
    }
  }

  /** 清除搜索命中的临时高亮（关闭搜索面板 / 清空时调用）。 */
  clearSearch(): void {
    try {
      this.view?.clearSearch?.();
    } catch {
      /* ignore */
    }
  }

  // ---- 事件处理 ----
  private onRelocate = (e: CustomEvent) => {
    this.drawFocus();
    const { fraction, cfi, location, index, section, tocItem } = e.detail ?? {};
    // 固定布局(PDF)的真实页索引来自 section.current（section index == 页 index）。
    // location.current 是 SectionProgress 按字符数估算的假页（每页 size≈1000、sizePerLoc=1500，
    // 约 1.5 个真页才 +1 个估算页），对 PDF 会滞后/错位，故 PDF 一律用 section.current。
    const fxlIndex = relocateSectionIndex(
      { index, section },
      this._isFixedLayout,
    );
    const pdfAnchor =
      this._isFixedLayout && typeof fxlIndex === "number"
        ? {
            pdf: {
              page: fxlIndex + 1,
              rects: [] as { x: number; y: number; w: number; h: number }[],
            },
          }
        : undefined;
    const locator: CanonicalLocator = {
      fraction: typeof fraction === "number" ? fraction : undefined,
      // PDF 现在 relocate 也带 CFI；仍需同时带真实页号供页码/书签使用，故两者都放。
      readerAnchors: cfi ? { epubcfi: cfi, ...(pdfAnchor ?? {}) } : pdfAnchor,
    };
    this.emit("relocate", {
      locator,
      sectionIndex: typeof fxlIndex === "number" ? fxlIndex : undefined,
      fraction: typeof fraction === "number" ? fraction : 0,
      // PDF：真实页号(section index+1) + 真实总页数；EPUB：SectionProgress 估算页
      page:
        pdfAnchor && typeof fxlIndex === "number"
          ? {
              current: fxlIndex + 1,
              total: this.getSectionCount() || (location?.total ?? 1),
            }
          : location
            ? { current: location.current ?? 1, total: location.total ?? 1 }
            : undefined,
      tocHref: tocItem?.href ?? null,
      tocLabel: tocItem?.label ?? null,
    });
  };

  private onUnload = (e: CustomEvent<{ doc: Document; index: number }>) => {
    this.boundDocs.get(e.detail.doc)?.();
    this.boundDocs.delete(e.detail.doc);
    this.cancelTap();
  };

  private onLoad = (e: CustomEvent) => {
    const { doc, index } = e.detail ?? {};
    if (doc) {
      // 套用主题模式类仅对重排式书籍（PDF/固定布局不需要，主题走 renderer 背景）
      if (!this._isFixedLayout && this.layout) {
        applyThemeModeClass(doc, getThemeCode(this.layout.theme).isDarkMode);
      }
      if (!this.boundDocs.has(doc)) {
        this.boundDocs.set(doc, this.bindInteraction(doc, doc, index));
      }
    }
    this.emit("load", { sectionIndex: index });
  };

  /** EPUB 章节创建覆盖层时补齐该章节已有标注（由上层通过 relayout 触发 draw）。 */
  private onCreateOverlay = (e: CustomEvent) => {
    this.emit("overlay-ready", { sectionIndex: e.detail?.index });
  };

  /** foliate 请求绘制某条标注时，按其 note 决定是否加"有备注"标记。 */
  private onDrawAnnotation = (e: CustomEvent) => {
    const { draw, annotation } = e.detail ?? {};
    const { annotationType, color, note } = annotation ?? {};
    const base = OVERLAYER_DRAW[annotationType as AnnotationStyle];
    if (!base) return;
    if (!note) {
      draw(base, { color, width: 2 });
      return;
    }
    draw(
      (rects: DOMRect[], opts: unknown) => {
        const shape = base(rects, opts);
        const marker = createNoteMarker(rects, color);
        if (!marker) return shape;
        // 包一层：标记与基础图形并列，不吃 highlight <g> 上的 opacity / blend-mode
        const wrapper = document.createElementNS(SVG_NS, "g");
        wrapper.append(shape, marker);
        return wrapper;
      },
      { color, width: 2 },
    );
  };

  /**
   * foliate 的 `link` 事件（cancelable）——点击了书内链接。若命中脚注引用则
   * `preventDefault()` 阻止跳转，解析并抽取该条脚注 HTML，`emit('footnote', ...)`；
   * 否则不干预，放行由 view 自身导航（普通章节内链接照常跳转）。
   * 固定布局（PDF）不启用脚注浮层。
   */
  private onLink = (e: Event) => {
    if (this._isFixedLayout) return;
    const detail = (e as CustomEvent).detail ?? {};
    const a: Element | undefined = detail.a;
    const href: string | undefined = detail.href;
    if (!a || !href) return;
    const { yes, maybe } = classifyFootnoteRef(a);
    if (!yes && !maybe) return; // 普通链接 → 放行导航
    e.preventDefault(); // 取消 view 的跳转（点脚注不翻走）
    void this.showFootnote(a, href);
  };

  /** 解析脚注目标文档、抽取该条脚注 HTML，并带上引用上标的视口坐标抛出事件。 */
  private async showFootnote(a: Element, href: string): Promise<void> {
    try {
      const book = this.view?.book;
      const resolved = await Promise.resolve(book?.resolveHref?.(href));
      if (!resolved || typeof resolved.index !== "number") return;
      const section = book.sections?.[resolved.index];
      if (!section?.createDocument) return;
      const doc: Document = await section.createDocument();
      const anchored = resolved.anchor?.(doc);
      // anchor 命中元素则用之；返回 0（整篇/无 fragment）时无从定位单条脚注，放弃
      const targetEl: Element | null =
        anchored && (anchored as Node).nodeType === 1
          ? (anchored as Element)
          : null;
      if (!targetEl) return;
      const block = extractFootnoteBlock(doc, targetEl);
      if (!block) return;
      const html = footnoteHtml(block).trim();
      if (!html) return;
      const type = referencedType(block) ?? referencedType(targetEl);
      const rect = toViewportRect(
        a.ownerDocument ?? undefined,
        a.getBoundingClientRect(),
      );
      this.emit("footnote", { href, html, type, rect });
    } catch (err) {
      console.error("[ReaderPort] footnote resolve failed", err);
    }
  }

  private cancelTap(): void {
    if (this.tapTimer !== null) window.clearTimeout(this.tapTimer);
    this.tapTimer = null;
  }

  private setEdgeHover(hover: ReaderEdgeHoverEvent | null): void {
    if (
      this.edgeHover?.edge === hover?.edge &&
      this.edgeHover?.side === hover?.side
    )
      return;
    this.edgeHover = hover;
    this.emit("edge-hover", hover);
  }

  private hasSelection(): boolean {
    return [document, ...this.boundDocs.keys()].some((doc) => {
      const selection = doc.getSelection();
      return (
        selection && !selection.isCollapsed && !!selection.toString().trim()
      );
    });
  }

  /** iframe 可能位移或缩放（固定布局），统一换算到顶层视口坐标。 */
  private viewportPoint(
    clientX: number,
    clientY: number,
    doc: Document | null,
  ) {
    if (!doc) return { x: clientX, y: clientY };
    const frame = doc.defaultView?.frameElement as HTMLElement | null;
    if (!frame || frame.offsetWidth <= 0 || frame.offsetHeight <= 0)
      return null;
    const rect = frame.getBoundingClientRect();
    return {
      x: rect.left + (clientX * rect.width) / frame.offsetWidth,
      y: rect.top + (clientY * rect.height) / frame.offsetHeight,
    };
  }

  private annotationHit(
    doc: Document | null,
    index: number | undefined,
    x: number,
    y: number,
  ): string | null {
    if (!doc) return null;
    const contents = this.view?.renderer
      ?.getContents?.()
      ?.find((c: any) => c.index === index);
    const hit = contents?.overlayer?.hitTest({ x, y })?.[0];
    return hit && !String(hit).startsWith("foliate-search:")
      ? String(hit)
      : null;
  }

  private isInteractive(target: Element | null): boolean {
    return !!target?.closest(
      'a[href], img, svg, audio, video, button, input, textarea, select, [contenteditable]:not([contenteditable="false"])',
    );
  }

  private bindInteraction(surface: Document | HTMLElement, doc: Document | null, index?: number): () => void {
    const adapter = this;
    return bindReaderDocumentInteractions(surface, doc, index, {
      clearFocus: () => this.clearFocus(), cancelTap: () => this.cancelTap(),
      setEdgeHover: value => this.setEdgeHover(value),
      viewportPoint: (x, y, doc) => this.viewportPoint(x, y, doc),
      hasSelection: () => this.hasSelection(), isInteractive: target => this.isInteractive(target),
      annotationHit: (doc, index, x, y) => this.annotationHit(doc, index, x, y),
      handleTap: (e, target, doc, index) => this.handleTap(e, target, doc, index),
      handleSelection: (index, doc) => this.handleSelection(index, doc),
      emit: (name, payload) => this.emit(name, payload),
      get container() { return adapter.container; }, get _rtl() { return adapter._rtl; },
      get pointerStart() { return adapter.pointerStart; }, set pointerStart(value) { adapter.pointerStart = value; },
      get clearingSelection() { return adapter.clearingSelection; }, set clearingSelection(value) { adapter.clearingSelection = value; },
      get suppressClick() { return adapter.suppressClick; }, set suppressClick(value) { adapter.suppressClick = value; },
      selectionResetters: this.selectionResetters,
    });
  }

  private handleTap(
    ev: MouseEvent,
    target: Element | null,
    doc: Document | null,
    index?: number,
  ): void {
    if (ev.button !== 0 || ev.detail > 1 || this.suppressClick) {
      this.cancelTap();
      return;
    }
    if (this.tapTimer !== null) {
      this.cancelTap();
      return;
    }
    const { clientX, clientY } = ev;
    const point = this.viewportPoint(clientX, clientY, doc);
    if (!point) return;
    this.tapTimer = window.setTimeout(() => {
      this.tapTimer = null;
      this.performTap(target, clientX, clientY, doc, index, point);
    }, 250);
  }

  private performTap(
    target: Element | null,
    clientX: number,
    clientY: number,
    doc: Document | null,
    index: number | undefined,
    point: { x: number; y: number },
  ): void {
    if (
      this.isInteractive(target) ||
      (doc && !doc.defaultView?.frameElement?.isConnected)
    )
      return;
    const rect = this.container?.getBoundingClientRect();
    if (
      !point ||
      !rect ||
      rect.width <= 0 ||
      point.x < rect.left ||
      point.x > rect.right ||
      point.y < rect.top ||
      point.y > rect.bottom
    )
      return;
    if (this.clearingSelection) {
      for (const selectedDoc of [document, ...this.boundDocs.keys()])
        selectedDoc.getSelection()?.removeAllRanges();
      this.clearingSelection = false;
      this.emit("tap", { side: "body" });
      return;
    }
    if (this.hasSelection()) return;
    const hit = this.annotationHit(doc, index, clientX, clientY);
    if (hit) {
      this.emit("tap-annotation", {
        anchorCfi: hit,
        overlapping: this.view.renderer.getContents().find((c: any) => c.index === index).overlayer
          .hitTestAll({ x: clientX, y: clientY })
          .filter(([key]: [string, Range]) => !String(key).startsWith("foliate-search:"))
          .map(([key]: [string, Range]) => ({ anchorCfi: String(key), ...this.annotationSelection(String(key), index, doc) })),
        ...this.annotationSelection(hit, index, doc),
        rect: { ...point, width: 0, height: 0 },
      });
      return;
    }
    const rel = toRelativeX(point.x, rect.left, rect.width);
    if (rel !== null)
      this.emit("tap", { side: resolveTapSide(rel, this._rtl, rect.width) });
  }

  private annotationSelection(cfi: string, index: number | undefined, doc: Document | null): Pick<ReaderEventMap["tap-annotation"], "epubSelection" | "selectionError"> {
    try {
      if (!doc || index === undefined) throw new Error("批注文档尚未加载");
      const resolved = this.view.resolveCFI(cfi);
      if (resolved.index !== index) throw new Error("批注章节与当前文档不一致");
      const range: Range = resolved.anchor(doc);
      const href = this.view.book.sections[index].id;
      if (range.collapsed || !range.toString().trim() || typeof href !== "string")
        throw new Error("批注没有可提问的正文范围");
      return { epubSelection: { sectionIndex: index, href, cfi, displayedQuote: range.toString() } };
    } catch {
      // A bad annotation anchor must not disable its edit/delete controls.
      return { selectionError: "无法准确定位此批注，请重新选择原文后询问 AI" };
    }
  }

  private handleSelection(index: number, doc: Document): void {
    const win = doc.defaultView ?? window;
    const sel = win.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      // 无选中文本：交给 click→tap 处理（关闭工具栏 / 翻页 / 显隐）
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // 命中已存在标注？（用于选中已高亮文本时进入编辑）
    let existingAnchorCfi: string | undefined;
    const contents = this.view?.renderer?.getContents?.();
    const obj = contents?.find((c: any) => c.index === index);
    if (obj?.overlayer) {
      const [hitValue] = obj.overlayer.hitTest({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      });
      if (hitValue && !String(hitValue).startsWith("foliate-search:")) {
        existingAnchorCfi = hitValue;
      }
    }

    const cfi = this.view?.getCFI?.(index, range) ?? "";
    const locator: CanonicalLocator = {
      textQuote: extractTextQuote(range),
      textPosition:
        typeof index === "number"
          ? { sectionIndex: index, start: -1, end: -1 }
          : undefined,
      readerAnchors: cfi ? { epubcfi: cfi } : undefined,
    };

    this.emit("selection", {
      text: range.toString().trim(),
      ...(typeof this.view?.book?.sections?.[index]?.id === "string" && cfi
        ? {
            epubSelection: {
              sectionIndex: index,
              href: this.view.book.sections[index].id,
              cfi,
              displayedQuote: range.toString(),
            },
          }
        : {}),
      locator,
      rect: toViewportRect(doc, rect),
      existingAnchorCfi,
    });
  }

  /**
   * 在指定章节 iframe 文档里用 TextQuote 找到 DOM Range（重锚定用）。
   * 返回 null 表示该章未加载或未匹配到。
   */
  private rangeFromQuote(
    sectionIndex: number,
    quote: TextQuoteSelector,
  ): Range | null {
    const entry = this.view?.renderer
      ?.getContents?.()
      ?.find((c: any) => c.index === sectionIndex);
    const doc: Document | undefined = entry?.doc;
    if (!doc?.body) return null;
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    const starts: number[] = [];
    let full = "";
    let node = walker.nextNode();
    while (node) {
      starts.push(full.length);
      nodes.push(node as Text);
      full += (node as Text).data;
      node = walker.nextNode();
    }
    const pos = findTextPosition(full, quote);
    if (!pos) return null;
    const locate = (offset: number): { node: Text; off: number } | null => {
      for (let i = 0; i < nodes.length; i++) {
        const s = starts[i];
        const e = s + nodes[i].data.length;
        if (offset >= s && offset <= e)
          return { node: nodes[i], off: offset - s };
      }
      return null;
    };
    const a = locate(pos.start);
    const b = locate(pos.end);
    if (!a || !b) return null;
    const range = doc.createRange();
    range.setStart(a.node, a.off);
    range.setEnd(b.node, b.off);
    return range;
  }
}
