import { describe, expect, it } from 'vitest';
import {
  genreDisplayLabel,
  isBookAnalysisReady,
  statusDisplayLabel,
} from '../features/metadata/domain/analysisState';

describe('书籍阅读画像展示状态', () => {
  it.each([
    ['technical', '技术类'],
    ['argumentation', '论证类'],
    ['narrative', '叙事类'],
    ['paper', '论文'],
    ['poetry', '诗歌'],
    ['popular-science', '科普'],
    ['self-help', '自我提升'],
    ['general', '通用'],
  ] as const)('将 %s 映射为稳定的中文类型标签', (genre, label) => {
    expect(genreDisplayLabel(genre)).toBe(label);
  });

  it.each([
    ['not_analyzed', '未分析'],
    ['pending', '排队中'],
    ['running', '分析中'],
    ['ready', '已完成'],
    ['failed', '失败'],
    ['stale', '需重新分析'],
    ['unsupported', '暂不支持 AI 预分析'],
  ] as const)('将 %s 映射为用户可理解的状态', (status, label) => {
    expect(statusDisplayLabel(status)).toBe(label);
  });

  it('只有 ready 且非 stale 的当前画像可用于 AI 阅读', () => {
    expect(isBookAnalysisReady({ status: 'ready', stale: false })).toBe(true);
    expect(isBookAnalysisReady({ status: 'ready', stale: true })).toBe(false);
    expect(isBookAnalysisReady({ status: 'stale', stale: true })).toBe(false);
    expect(isBookAnalysisReady({ status: 'pending', stale: false })).toBe(false);
    expect(isBookAnalysisReady(null)).toBe(false);
  });
});
