import { describe, expect, it } from 'vitest';
import { resolvePdfLoadingMode } from '../lib/reader/pdfLoadingMode';

describe('resolvePdfLoadingMode', () => {
  it('accepts the two explicit overrides', () => {
    expect(resolvePdfLoadingMode('full')).toBe('full');
    expect(resolvePdfLoadingMode('range')).toBe('range');
  });

  it('falls back to auto instead of locking one strategy in', () => {
    // auto 会按文件大小自己选（见 pdfLoadStrategy.ts）；配置写错时退回 auto 比
    // 静默锁死某一种更安全——锁死 range 会让小书白白多几趟往返，锁死 full 会让
    // 几百 MB 的大书整份下载。
    expect(resolvePdfLoadingMode(undefined)).toBe('auto');
    expect(resolvePdfLoadingMode('auto')).toBe('auto');
    expect(resolvePdfLoadingMode('FULL')).toBe('auto');
    expect(resolvePdfLoadingMode('true')).toBe('auto');
  });
});
