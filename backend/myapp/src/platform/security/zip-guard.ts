import type AdmZip from "adm-zip";
import { AppException } from "../http/app-exception";

// EPUB 本质是 zip，正常体积都很小。下列上限很宽松，仅用于挡住
// 「Zip 炸弹」（极高压缩比 / 海量条目 → 解压时撑爆内存）。
const MAX_ENTRIES = 5000; // 条目数上限
const MAX_ENTRY_SIZE = 50 * 1024 * 1024; // 单条目解压后上限 50MB
const MAX_TOTAL_SIZE = 200 * 1024 * 1024; // 整包解压后累计上限 200MB

/**
 * 在调用 getData()/readAsText() 解压前，先按中央目录里记录的「未压缩大小」
 * 做体积/数量校验，避免恶意压缩包在解压阶段耗尽内存。
 */
export function assertZipWithinLimits(zip: AdmZip): void {
  const entries = zip.getEntries();
  if (entries.length > MAX_ENTRIES) {
    throw AppException.validation("file", "压缩包条目过多，疑似异常文件");
  }

  let total = 0;
  for (const entry of entries) {
    const size = Number(entry.header?.size ?? 0);
    if (size > MAX_ENTRY_SIZE) {
      throw AppException.validation("file", "压缩包内单个文件解压后过大，疑似异常文件");
    }
    total += size;
    if (total > MAX_TOTAL_SIZE) {
      throw AppException.validation("file", "压缩包解压后总体积过大，疑似异常文件");
    }
  }
}
