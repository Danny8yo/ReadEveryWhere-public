import { describe, expect, it } from 'vitest';
import {
  PDF_WHOLE_DOWNLOAD_MAX_BYTES,
  shouldDownloadPdfWhole,
} from '../domain/pdfLoadStrategy';

describe('shouldDownloadPdfWhole', () => {
  it('阈值以内的书整份下载', () => {
    expect(shouldDownloadPdfWhole(1)).toBe(true);
    expect(shouldDownloadPdfWhole(10 * 1024 * 1024)).toBe(true);
    expect(shouldDownloadPdfWhole(PDF_WHOLE_DOWNLOAD_MAX_BYTES)).toBe(true);
  });

  it('超过阈值的大书走按需分块', () => {
    expect(shouldDownloadPdfWhole(PDF_WHOLE_DOWNLOAD_MAX_BYTES + 1)).toBe(false);
    expect(shouldDownloadPdfWhole(200 * 1024 * 1024)).toBe(false);
  });

  it('大小未知或非法时保持按需分块', () => {
    // 宁可多几趟往返，也不要盲目整份拉一本可能有几百 MB 的书。
    expect(shouldDownloadPdfWhole(null)).toBe(false);
    expect(shouldDownloadPdfWhole(undefined)).toBe(false);
    expect(shouldDownloadPdfWhole(0)).toBe(false);
    expect(shouldDownloadPdfWhole(-1)).toBe(false);
    expect(shouldDownloadPdfWhole(Number.NaN)).toBe(false);
    expect(shouldDownloadPdfWhole(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('VITE_PDF_LOADING_MODE 可以强制覆盖，用于 A/B 对比', () => {
    expect(shouldDownloadPdfWhole(500 * 1024 * 1024, 'full')).toBe(true);
    expect(shouldDownloadPdfWhole(1024, 'range')).toBe(false);
  });
});
