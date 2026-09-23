import { resolveTapSide, toRelativeX } from '../../../features/reader/domain/gestures';
import type { ReaderEdgeHoverEvent } from '../../../features/reader/domain/ReaderPort';

type Point = { x: number; y: number };
export interface DocumentInteractionContext {
  clearFocus(): void;
  cancelTap(): void;
  setEdgeHover(value: ReaderEdgeHoverEvent | null): void;
  viewportPoint(x: number, y: number, doc: Document | null): Point | null;
  hasSelection(): boolean;
  isInteractive(target: Element | null): boolean;
  annotationHit(doc: Document | null, index: number | undefined, x: number, y: number): string | null;
  handleTap(e: MouseEvent, target: Element | null, doc: Document | null, index?: number): void;
  handleSelection(index: number, doc: Document): void;
  emit(name: 'selection-cleared' | 'key-navigation', payload: undefined | { side: 'prev' | 'next' }): void;
  container: HTMLElement | null;
  _rtl: boolean;
  pointerStart: Point | null;
  clearingSelection: boolean;
  suppressClick: boolean;
  selectionResetters: Set<() => void>;
}

/** One binding per document. Cleanup cancels pending selections immediately on unmount. */
export function bindReaderDocumentInteractions(
  surface: Document | HTMLElement, doc: Document | null, index: number | undefined,
  context: DocumentInteractionContext,
): () => void {
    const cleanup: Array<() => void> = [];
    const listen = (name: string, handler: (e: any) => void) => {
      surface.addEventListener(name, handler, true);
      cleanup.push(() => surface.removeEventListener(name, handler, true));
    };
    const targetOf = (e: Event): Element | null => {
      const target = e.composedPath()[0] as Node | undefined;
      return target?.nodeType === 1 ? (target as Element) : null;
    };
    listen("pointerdown", (e: PointerEvent) => {
      context.clearFocus();
      context.cancelTap();
      context.setEdgeHover(null);
      context.pointerStart = context.viewportPoint(e.clientX, e.clientY, doc);
      // 点掉既有选区也不能顺带翻页。下一次独立按下时重新判断。
      context.clearingSelection = context.hasSelection();
      context.suppressClick = e.button !== 0;
    });
    listen("pointermove", (e: PointerEvent) => {
      const point = context.viewportPoint(e.clientX, e.clientY, doc);
      if (
        point &&
        context.pointerStart &&
        e.buttons !== 0 &&
        Math.hypot(
          point.x - context.pointerStart.x,
          point.y - context.pointerStart.y,
        ) > 6
      ) {
        context.suppressClick = true;
        context.cancelTap();
      }
      const rect = context.container?.getBoundingClientRect();
      if (
        e.pointerType !== "mouse" ||
        e.buttons !== 0 ||
        !point ||
        !rect ||
        rect.width <= 0 ||
        point.y < rect.top ||
        point.y > rect.bottom ||
        context.hasSelection() ||
        context.isInteractive(targetOf(e)) ||
        context.annotationHit(doc, index, e.clientX, e.clientY)
      ) {
        context.setEdgeHover(null);
        return;
      }
      const rel = toRelativeX(point.x, rect.left, rect.width);
      const side =
        rel === null ? "body" : resolveTapSide(rel, context._rtl, rect.width);
      context.setEdgeHover(
        side === "prev" || side === "next"
          ? {
              edge: point.x < rect.left + rect.width / 2 ? "left" : "right",
              side,
            }
          : null,
      );
    });
    listen("pointerleave", () => context.setEdgeHover(null));
    listen("pointercancel", () => {
      context.suppressClick = true;
      context.cancelTap();
      context.setEdgeHover(null);
    });
    listen("wheel", () => {
      context.cancelTap();
      context.setEdgeHover(null);
    });
    listen("click", (e: MouseEvent) =>
      context.handleTap(e, targetOf(e), doc, index),
    );
    if (doc && index !== undefined) {
      listen("keydown", (e: KeyboardEvent) => {
        if (
          e.defaultPrevented ||
          e.altKey ||
          e.ctrlKey ||
          e.metaKey ||
          e.shiftKey ||
          context.isInteractive(targetOf(e)) ||
          context.hasSelection()
        )
          return;
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        context.cancelTap();
        context.setEdgeHover(null);
        context.emit("key-navigation", {
          side: e.key === "ArrowLeft" ? "prev" : "next",
        });
      });
      let selectionTimer: number | null = null;
      let lastRange: Range | null = null;
      let lastText = "";
      const resetSelection = () => {
        if (selectionTimer !== null) window.clearTimeout(selectionTimer);
        selectionTimer = null;
        const hadSelection = lastRange !== null;
        lastRange = null;
        lastText = "";
        if (hadSelection) context.emit("selection-cleared", undefined);
      };
      const publishSelection = () => {
        if (selectionTimer !== null) window.clearTimeout(selectionTimer);
        selectionTimer = null;
        if (!doc.defaultView?.frameElement?.isConnected) {
          resetSelection();
          return;
        }
        const selection = doc.getSelection();
        const text = selection?.toString().trim() ?? "";
        if (!selection || selection.isCollapsed || !selection.rangeCount || !text) {
          resetSelection();
          return;
        }
        const range = selection.getRangeAt(0);
        if (lastRange && lastText === text &&
            lastRange.startContainer === range.startContainer && lastRange.startOffset === range.startOffset &&
            lastRange.endContainer === range.endContainer && lastRange.endOffset === range.endOffset) return;
        lastRange = range.cloneRange();
        lastText = text;
        context.handleSelection(index, doc);
      };
      const scheduleSelection = (delay: number) => {
        if (selectionTimer !== null) window.clearTimeout(selectionTimer);
        selectionTimer = window.setTimeout(publishSelection, delay);
      };
      listen("mouseup", () => scheduleSelection(0));
      listen("selectionchange", () => {
        if (context.hasSelection()) {
          context.cancelTap();
          context.setEdgeHover(null);
        }
        // iOS 长按和手柄调整不保证产生 mouseup；监听正文 Document。
        scheduleSelection(100);
      });
      const clearForNavigation = () => {
        resetSelection();
        doc.getSelection()?.removeAllRanges();
      };
      context.selectionResetters.add(clearForNavigation);
      // 外层工具栏接管焦点前同步捕获最后一次手柄调整，不能丢掉合并窗口内的变化。
      const flushBeforeAction = () => {
        if (selectionTimer !== null) publishSelection();
      };
      document.addEventListener("pointerdown", flushBeforeAction, true);
      cleanup.push(() => {
        resetSelection();
        context.selectionResetters.delete(clearForNavigation);
        document.removeEventListener("pointerdown", flushBeforeAction, true);
      });
    }
    return () => cleanup.forEach((unbind) => unbind());
}
