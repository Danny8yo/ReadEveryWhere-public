/**
 * 重锚定核心（阅读器无关）。
 *
 * 标注真相是 TextQuote（精确串 + 前后缀）。当引擎特定锚点（CFI）失效
 * （换引擎 / 换版本 / 重新导入）时，用章节规范化文本重新定位标注。
 *
 * 本文件不依赖任何引擎；`extractTextQuote` 也被 FoliateReaderAdapter 复用。
 */
import type { TextQuoteSelector } from '../domain/ReaderPort';


/** 前后缀上下文长度（字符）。 */
export const CONTEXT_LEN = 32;

/** 从选区 Range 提取 TextQuote（精确串 + 前后缀上下文）。 */
export function extractTextQuote(range: Range): TextQuoteSelector {
  const exact = range.toString();
  let prefix = '';
  let suffix = '';
  try {
    const startNode = range.startContainer;
    if (startNode.nodeType === Node.TEXT_NODE) {
      prefix = (startNode.textContent ?? '').slice(
        Math.max(0, range.startOffset - CONTEXT_LEN),
        range.startOffset,
      );
    }
    const endNode = range.endContainer;
    if (endNode.nodeType === Node.TEXT_NODE) {
      suffix = (endNode.textContent ?? '').slice(range.endOffset, range.endOffset + CONTEXT_LEN);
    }
  } catch {
    /* 上下文提取失败不影响主流程 */
  }
  return { exact, prefix: prefix || undefined, suffix: suffix || undefined };
}

/**
 * 在给定的章节规范化文本里，用 TextQuote 找到精确串的字符区间 [start, end)。
 *
 * 若精确串出现多次，用 prefix/suffix 上下文消歧（选择前后缀匹配度最高的一处）。
 * 找不到返回 null（交由上层降级：忽略该标注或用其它锚点）。
 */
export function findTextPosition(
  sectionText: string,
  quote: TextQuoteSelector,
): { start: number; end: number } | null {
  const exact = quote.exact;
  if (!exact) return null;

  // 收集所有出现位置
  const occurrences: number[] = [];
  let idx = sectionText.indexOf(exact);
  while (idx !== -1) {
    occurrences.push(idx);
    idx = sectionText.indexOf(exact, idx + 1);
  }
  if (occurrences.length === 0) return null;
  if (occurrences.length === 1) {
    return { start: occurrences[0], end: occurrences[0] + exact.length };
  }

  // 多处命中：按前后缀上下文匹配长度打分，取最高
  const prefix = quote.prefix ?? '';
  const suffix = quote.suffix ?? '';
  let best = occurrences[0];
  let bestScore = -1;
  for (const pos of occurrences) {
    const before = sectionText.slice(Math.max(0, pos - prefix.length), pos);
    const after = sectionText.slice(pos + exact.length, pos + exact.length + suffix.length);
    const score = commonSuffixLen(before, prefix) + commonPrefixLen(after, suffix);
    if (score > bestScore) {
      bestScore = score;
      best = pos;
    }
  }
  return { start: best, end: best + exact.length };
}

/** a 的后缀与 b 的后缀（此处 b 即 prefix 本身）的公共尾部长度。 */
function commonSuffixLen(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

/** a 与 b 的公共前缀长度。 */
function commonPrefixLen(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}
