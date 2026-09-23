import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock('../services/apiClient', () => ({ request: requestMock }));

import { aiReadingApi } from '../features/ai-reading/api/aiReadingApi';

describe('aiReadingApi 契约', () => {
  beforeEach(() => requestMock.mockReset());

  it('保存配置时只发送用户明确提供的模型字段', async () => {
    requestMock.mockResolvedValue({});
    await aiReadingApi.saveModelConfig({ apiKey: 'secret', modelId: 'deepseek-v4-flash' });
    expect(requestMock).toHaveBeenCalledWith('/api/v1/ai-reading/model-config', {
      method: 'PUT',
      body: JSON.stringify({ apiKey: 'secret', modelId: 'deepseek-v4-flash' }),
    });
  });

  it('删除完整模型配置', async () => {
    requestMock.mockResolvedValue({ deleted: true });
    await aiReadingApi.deleteModelConfig();
    expect(requestMock).toHaveBeenCalledWith('/api/v1/ai-reading/model-config', {
      method: 'DELETE',
    });
  });

  it('读取服务端版本化预算模板与约束', async () => {
    requestMock.mockResolvedValue({});
    await aiReadingApi.getBudgetConfig();
    expect(requestMock).toHaveBeenCalledWith('/api/v1/ai-reading/budget-config');
  });

  it('创建单书会话时发送首轮消息、预算和阅读器焦点', async () => {
    requestMock.mockResolvedValue({});
    await aiReadingApi.createConversation({
      bookId: 42,
      message: '比较本章的两条论证路径',
      budgetTier: 'standard',
      readerFocus: { sectionIndex: 7, chapterLabel: '第七章' },
    });
    expect(requestMock).toHaveBeenCalledWith('/api/v1/ai-reading/conversations', {
      method: 'POST',
      body: JSON.stringify({
        bookId: 42,
        message: '比较本章的两条论证路径',
        budgetTier: 'standard',
        readerFocus: { sectionIndex: 7, chapterLabel: '第七章' },
      }),
    });
  });

  it('按 turn 增量读取事件并编码会话和 turn id', async () => {
    requestMock.mockResolvedValue({ items: [], nextSequence: 9, hasMore: false });
    await aiReadingApi.listConversationTurnEvents('conversation/id', 'turn/id', 9, 50);
    expect(requestMock).toHaveBeenCalledWith(
      '/api/v1/ai-reading/conversations/conversation%2Fid/turns/turn%2Fid/events',
      { params: { afterSequence: 9, limit: 50 } },
    );
  });

  it('追问、重试、停止和删除均使用会话所有权路径', async () => {
    requestMock.mockResolvedValue({});
    await aiReadingApi.createConversationTurn('conversation/id', {
      message: '解释上一条',
      budgetTier: 'quick',
    });
    await aiReadingApi.retryConversationTurn('conversation/id', 'turn/id', {});
    await aiReadingApi.cancelConversationTurn('conversation/id', 'turn/id');
    await aiReadingApi.deleteConversation('conversation/id');

    expect(requestMock.mock.calls).toEqual([
      ['/api/v1/ai-reading/conversations/conversation%2Fid/turns', {
        method: 'POST',
        body: JSON.stringify({ message: '解释上一条', budgetTier: 'quick' }),
      }],
      ['/api/v1/ai-reading/conversations/conversation%2Fid/turns/turn%2Fid/retry', {
        method: 'POST',
        body: JSON.stringify({}),
      }],
      ['/api/v1/ai-reading/conversations/conversation%2Fid/turns/turn%2Fid/cancel', {
        method: 'POST',
      }],
      ['/api/v1/ai-reading/conversations/conversation%2Fid', { method: 'DELETE' }],
    ]);
  });
});
