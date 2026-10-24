import type { ReaderRelocateEvent, ReaderTapEvent } from './ReaderPort';


export interface ReaderInteractionState {
  blocked: boolean;
  panelOpen: boolean;
  noteModalVisible: boolean;
  toolbarVisible: boolean;
  footnoteVisible: boolean;
  paginated: boolean;
}

export function canTurnByEdge(state: ReaderInteractionState): boolean {
  return state.paginated && !state.blocked && !state.panelOpen
    && !state.noteModalVisible && !state.toolbarVisible && !state.footnoteVisible;
}

/** 只控制内容区单击；按钮和键盘使用各自的明确导航入口。 */
export function resolveReaderTapAction(
  side: ReaderTapEvent['side'], state: ReaderInteractionState,
): 'none' | 'dismiss-popups' | 'toggle-ui' | 'prev' | 'next' {
  if (state.blocked || state.noteModalVisible) return 'none';
  if (state.toolbarVisible || state.footnoteVisible) return 'dismiss-popups';
  if (state.panelOpen) return 'none';
  if (side === 'center' || (!state.paginated && (side === 'prev' || side === 'next'))) return 'toggle-ui';
  if ((side === 'prev' || side === 'next') && canTurnByEdge(state)) return side;
  return 'none';
}

/**
 * relocate 对应的阅读位置：PDF 取页码，EPUB 取章节与进度。引擎在布局稳定、视口尺寸变化
 * （例如手机地址栏收起）时也会发出位置不变的 relocate，只有位置变化才算翻页或跳转。
 */
export function readerRelocatePosition(event: ReaderRelocateEvent): string {
  const pdfPage = event.locator.readerAnchors?.pdf?.page;
  return typeof pdfPage === 'number' ? `pdf:${pdfPage}` : `${event.sectionIndex ?? ''}:${event.fraction}`;
}
