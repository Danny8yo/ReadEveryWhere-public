import type { PdfLoadingMode } from "./pdfLoadingMode";

/**
 * PDF 是整份下载还是走按需分块。
 *
 * 按需分块省的是字节，但在高延迟链路上省不了时间。实测线上这条链路：单次大传输能跑到
 * 7.1MB/s（82.5MB 用了 11.58 秒），而一次 Range 请求不管拉 256KB 还是 1MB 都要 ~800ms
 * （RTT 约 340ms，加上小传输根本没机会走出慢启动）。也就是说**请求次数才是成本，1MB 以内的
 * 字节几乎免费**。
 *
 * 于是账变成「趟数 × 0.8 秒」对「文件大小 ÷ 7.1MB/s」。按实测的趟数：
 *   10MB 的书恢复到中间页要 3 趟 ≈ 2.6s，整份下载 1.8s   → 整份赢
 *   62MB 的书要 13 趟 ≈ 11s，整份下载 9.2s               → 整份仍略赢
 *   111MB 的书要 10 趟 ≈ 8.5s，整份下载 16s              → 分块赢
 * 交叉点在 60~80MB，取 64MB 偏保守一档，同时把浏览器里驻留的 ArrayBuffer 控制在可接受范围。
 *
 * 这个阈值跟链路强绑定：低带宽高延迟（比如移动网络）下每趟便宜、整份贵，交叉点会低得多。
 * 换网络环境要重新量，别照抄。
 */
export const PDF_WHOLE_DOWNLOAD_MAX_BYTES = 64 * 1024 * 1024;

/**
 * 文件大小未知时保持按需分块：宁可多几趟往返，也不要盲目拉一本可能有几百 MB 的书。
 * `full` / `range` 是 VITE_PDF_LOADING_MODE 的强制覆盖，用于 A/B 对比。
 */
export function shouldDownloadPdfWhole(
  fileSize: number | null | undefined,
  mode: PdfLoadingMode = "auto",
): boolean {
  if (mode === "full") return true;
  if (mode === "range") return false;
  return typeof fileSize === "number"
    && Number.isFinite(fileSize)
    && fileSize > 0
    && fileSize <= PDF_WHOLE_DOWNLOAD_MAX_BYTES;
}
