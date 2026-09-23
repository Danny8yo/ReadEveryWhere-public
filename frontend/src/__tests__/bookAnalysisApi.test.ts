import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock('../services/apiClient', () => ({ request: requestMock }));

import { bookAnalysisApi } from '../features/metadata/api/bookAnalysisApi';

describe('bookAnalysisApi 契约', () => {
  beforeEach(() => requestMock.mockReset());

  it('读取单本书当前分析状态', async () => {
    requestMock.mockResolvedValue({ status: 'not_analyzed' });

    await bookAnalysisApi.getBookAnalysis(42);

    expect(requestMock).toHaveBeenCalledWith('/api/v1/book-analysis/books/42');
  });

  it('提交单本分析并显式传递 force', async () => {
    requestMock.mockResolvedValue({ outcome: 'accepted' });

    await bookAnalysisApi.analyzeBook(42, { force: true });

    expect(requestMock).toHaveBeenCalledWith('/api/v1/book-analysis/books/42', {
      method: 'POST',
      body: JSON.stringify({ force: true }),
    });
  });

  it('批量提交只发送书籍 ID 和 force，保留逐书结果', async () => {
    const response = {
      items: [
        { bookId: 11, outcome: 'accepted', status: 'pending' },
        { bookId: 12, outcome: 'skipped', status: 'ready' },
        { bookId: 13, outcome: 'rejected', status: 'failed', errorCode: 'BOOK_FILE_MISSING' },
      ],
    };
    requestMock.mockResolvedValue(response);

    const result = await bookAnalysisApi.analyzeBatch({ bookIds: [11, 12, 13], force: false });

    expect(requestMock).toHaveBeenCalledWith('/api/v1/book-analysis/batch', {
      method: 'POST',
      body: JSON.stringify({ bookIds: [11, 12, 13], force: false }),
    });
    expect(result.items.map((item) => item.outcome)).toEqual(['accepted', 'skipped', 'rejected']);
  });
});
