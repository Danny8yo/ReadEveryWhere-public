// 书架批量 AI 预分析：结果面板只在整批结束后才能关闭。
import { describe, expect, it, vi } from 'vitest';
import { createBatchAnalysisController, createBatchAnalysisState } from '../domain/batchAnalysis';
import type { LibraryBook } from '../model/library';
import type { BookAnalysisDetail } from '../../metadata/model/bookAnalysis';

function setup(getBookAnalysis: (id: number) => Promise<BookAnalysisDetail>) {
  const state = createBatchAnalysisState();
  const timers: Array<() => void> = [];
  const controller = createBatchAnalysisController(state, {
    books: [{ id: 1, title: '活着' } as LibraryBook],
    selectedBookIds: [1],
    updateAnalysis: () => {},
  }, {
    getBookAnalysis,
    analyzeBatch: async () => ({ items: [{ bookId: 1, disposition: 'accepted', status: 'pending' }] } as never),
  }, { setTimeout: (callback) => timers.push(callback), clearTimeout: () => {} });
  return { state, controller, timers };
}

describe('批量 AI 预分析结果面板', () => {
  it('分析进行中不能关闭，整批结束后关闭会清空结果', async () => {
    let status = 'running';
    const { state, controller, timers } = setup(async (id) => ({ bookId: id, status } as BookAnalysisDetail));

    await controller.handleBatchAnalyze();
    await vi.waitFor(() => expect(timers).toHaveLength(1));
    expect(state.batchAnalysisResults[0].seenStatuses).toContain('running');
    expect(state.isBatchAnalyzing).toBe(true);
    controller.dismissBatchResults();
    expect(state.batchAnalysisResults).toHaveLength(1);

    status = 'ready';
    timers.shift()!();
    await vi.waitFor(() => expect(state.isBatchAnalyzing).toBe(false));
    controller.dismissBatchResults();
    expect(state.batchAnalysisResults).toEqual([]);
    expect(state.batchAnalysisError).toBeNull();
    controller.dispose();
  });
});
