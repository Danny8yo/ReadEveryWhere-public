import type { ReaderTapEvent } from '../../features/reader/domain/ReaderPort';


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
