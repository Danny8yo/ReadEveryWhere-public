export type PdfLoadingMode = "auto" | "range" | "full";

/**
 * `auto`（默认）按文件大小自动选择，见 pdfLoadStrategy.ts；`full` / `range` 是强制覆盖，
 * 用于 A/B 对比。配置非法时回到 auto，而不是静默锁死某一种。
 */
export function resolvePdfLoadingMode(value: unknown): PdfLoadingMode {
  if (value === "full") return "full";
  if (value === "range") return "range";
  return "auto";
}
