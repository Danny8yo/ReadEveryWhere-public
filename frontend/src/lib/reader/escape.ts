export interface ReaderEscapeState {
  footnoteVisible: boolean;
  toolbarVisible: boolean;
  noteModalVisible: boolean;
  searchOpen: boolean;
  sidebarOpen: boolean;
  settingsOpen: boolean;
}

export type ReaderEscapeAction =
  | 'close_footnote'
  | 'close_toolbar'
  | 'close_note_modal'
  | 'close_search'
  | 'close_sidebar'
  | 'close_settings'
  | 'close_reader';

export function resolveReaderEscapeAction(state: ReaderEscapeState): ReaderEscapeAction {
  if (state.footnoteVisible) return 'close_footnote';
  if (state.toolbarVisible) return 'close_toolbar';
  if (state.noteModalVisible) return 'close_note_modal';
  if (state.searchOpen) return 'close_search';
  if (state.sidebarOpen) return 'close_sidebar';
  if (state.settingsOpen) return 'close_settings';
  return 'close_reader';
}
