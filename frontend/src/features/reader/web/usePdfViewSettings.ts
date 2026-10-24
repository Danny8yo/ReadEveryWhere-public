import { reactive, watch } from 'vue';

/**
 * PDF 视图偏好（缩放 + 单/双页），按书持久化。
 *
 * 与 useReaderSettings 的全局排版偏好不同：合适的缩放取决于该 PDF 自身的页面尺寸，
 * 所以按 bookId 存，和 useReaderProgress 的阅读位置一样是"每本书的状态"。
 */
export type PdfLayout = 'single' | 'double';
export type PdfZoom = number | 'fit-width';

export interface PdfViewSettings {
  layout: PdfLayout;
  /** 'fit-width' 或缩放倍率（1 = 100%） */
  zoom: PdfZoom;
  /** 滑块位置；即使当前是 fit-width 也保留，便于切回百分比缩放 */
  zoomPercent: number;
}

export const PDF_ZOOM_MIN_PERCENT = 50;
export const PDF_ZOOM_MAX_PERCENT = 300;
export const PDF_ZOOM_STEP_PERCENT = 5;

const STORAGE_PREFIX = 'readEveryWhere.pdfView.';

const DEFAULTS: PdfViewSettings = {
  layout: 'single',
  zoom: 'fit-width',
  zoomPercent: 100,
};

export function clampPdfZoomPercent(value: number) {
  if (!Number.isFinite(value)) return 100;
  return Math.min(PDF_ZOOM_MAX_PERCENT, Math.max(PDF_ZOOM_MIN_PERCENT, Math.round(value)));
}

function sanitize(raw: unknown): PdfViewSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULTS };
  const { layout, zoom, zoomPercent } = raw as Partial<PdfViewSettings>;
  const percent = clampPdfZoomPercent(Number(zoomPercent));
  return {
    layout: layout === 'double' ? 'double' : 'single',
    zoom: zoom === 'fit-width' || !Number.isFinite(Number(zoom))
      ? 'fit-width'
      : clampPdfZoomPercent(Number(zoom) * 100) / 100,
    zoomPercent: Number.isFinite(Number(zoomPercent)) ? percent : 100,
  };
}

function load(bookId: number): PdfViewSettings {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + bookId);
    if (raw) return sanitize(JSON.parse(raw));
  } catch {
    /* 损坏或不可用时回落默认 */
  }
  return { ...DEFAULTS };
}

export function usePdfViewSettings(bookId: number) {
  const pdfView = reactive<PdfViewSettings>(load(bookId));

  watch(
    pdfView,
    (value) => {
      try {
        localStorage.setItem(STORAGE_PREFIX + bookId, JSON.stringify(value));
      } catch {
        /* 配额超限等忽略 */
      }
    },
    { deep: true },
  );

  return { pdfView };
}
