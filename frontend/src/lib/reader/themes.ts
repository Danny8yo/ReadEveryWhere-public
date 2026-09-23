/**
 * 阅读器主题调色板（readest daisyUI 全套的极简版）。
 *
 * 用于正规主题色注入：`html { background: bg; color: fg }` + `color-scheme`，
 * 取代此前 `filter: invert()` 的粗暴反色（暗色发灰、图片被反色的根因）。
 */

export type ReaderTheme = 'light' | 'dark' | 'sepia';

export interface ThemePalette {
  bg: string;
  fg: string;
  primary: string;
  isDarkMode: boolean;
}

const PALETTES: Record<ReaderTheme, ThemePalette> = {
  light: { bg: '#ffffff', fg: '#1a1a1a', primary: '#2563eb', isDarkMode: false },
  dark: { bg: '#1a1a1a', fg: '#cfcfcf', primary: '#7aa2f7', isDarkMode: true },
  sepia: { bg: '#f5f0e1', fg: '#5b4636', primary: '#8a6d3b', isDarkMode: false },
};

export function getThemeCode(theme: ReaderTheme): ThemePalette {
  return PALETTES[theme] ?? PALETTES.light;
}
