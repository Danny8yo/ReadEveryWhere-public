import { describe, expect, it } from 'vitest';
import { resolveReaderEscapeAction } from '../domain/escape';

describe('阅读器 Escape 优先级', () => {
  it('脚注打开时优先关闭脚注，不关闭阅读器', () => {
    expect(resolveReaderEscapeAction({
      footnoteVisible: true,
      toolbarVisible: false,
      noteModalVisible: false,
      searchOpen: false,
      sidebarOpen: false,
      settingsOpen: false,
    })).toBe('close_footnote');
  });

  it('所有浮层关闭后才关闭阅读器', () => {
    expect(resolveReaderEscapeAction({
      footnoteVisible: false,
      toolbarVisible: false,
      noteModalVisible: false,
      searchOpen: false,
      sidebarOpen: false,
      settingsOpen: false,
    })).toBe('close_reader');
  });
});
