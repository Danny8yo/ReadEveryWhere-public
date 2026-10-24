import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock('../../../shared/web/apiClient', () => ({ request: requestMock }));

import { aiModelApi } from '../api/aiModelApi';

describe('aiModelApi 契约', () => {
  beforeEach(() => requestMock.mockReset());

  it('保存配置时只发送用户明确提供的模型字段', async () => {
    requestMock.mockResolvedValue({});
    await aiModelApi.saveModelConfig({ apiKey: 'secret', modelId: 'deepseek-v4-flash' });
    expect(requestMock).toHaveBeenCalledWith('/api/v1/ai-reading/model-config', {
      method: 'PUT',
      body: JSON.stringify({ apiKey: 'secret', modelId: 'deepseek-v4-flash' }),
    });
  });

  it('删除完整模型配置', async () => {
    requestMock.mockResolvedValue({ deleted: true });
    await aiModelApi.deleteModelConfig();
    expect(requestMock).toHaveBeenCalledWith('/api/v1/ai-reading/model-config', {
      method: 'DELETE',
    });
  });

});
