import { describe, expect, it } from 'vitest';
import { getStyles } from '../web/style';
import { getThemeCode } from '../domain/themes';
import type { ReaderLayoutSettings } from '../domain/ReaderPort';


const baseSettings: ReaderLayoutSettings = {
  fontSize: 18,
  fontFamily: 'serif',
  lineSpacing: 1.6,
  justify: true,
  flow: 'paginated',
  theme: 'dark',
  marginPx: 20,
  gapPercent: 5,
  maxColumnCount: 1,
  maxInlineSize: 1200,
};

describe('reader themes', () => {
  it('marks dark/sepia palettes correctly', () => {
    expect(getThemeCode('dark').isDarkMode).toBe(true);
    expect(getThemeCode('light').isDarkMode).toBe(false);
    expect(getThemeCode('sepia').isDarkMode).toBe(false);
    expect(getThemeCode('sepia').bg).toBe('#f5f0e1');
  });

  it('falls back to light for unknown theme', () => {
    // @ts-expect-error intentional invalid input
    expect(getThemeCode('nope').bg).toBe('#ffffff');
  });
});

describe('getStyles', () => {
  it('injects proper theme colors instead of filter:invert', () => {
    const css = getStyles(baseSettings, getThemeCode('dark'));
    expect(css).toContain('--theme-bg-color: #1a1a1a');
    expect(css).toContain('--theme-fg-color: #cfcfcf');
    expect(css).toContain('color-scheme: dark');
    // must NOT rely on invert filter
    expect(css).not.toContain('invert(');
  });

  it('reflects font-size, family and justify settings', () => {
    const css = getStyles(baseSettings, getThemeCode('light'));
    expect(css).toContain('font-size: 18px');
    expect(css).toContain('Georgia');
    expect(css).toContain('text-align: justify');
  });

  it('forces line spacing over book stylesheets', () => {
    const css = getStyles({ ...baseSettings, lineSpacing: 2 }, getThemeCode('light'));
    expect(css).toContain('line-height: 2 !important');
  });

  it('uses start alignment when justify is off', () => {
    const css = getStyles({ ...baseSettings, justify: false }, getThemeCode('light'));
    expect(css).toContain('text-align: start');
  });
});
