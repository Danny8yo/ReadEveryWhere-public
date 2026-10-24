import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock('../../../shared/web/apiClient', () => ({ request: requestMock }));

import { zlibraryApi } from '../api/zlibraryApi';

describe('zlibraryApi 契约', () => {
  beforeEach(() => requestMock.mockReset());

  it('删除当前用户的完整 Z-Library 配置', async () => {
    requestMock.mockResolvedValue({ deleted: true });
    await zlibraryApi.deleteConfig();
    expect(requestMock).toHaveBeenCalledWith('/api/v1/user/zlibrary-config', {
      method: 'DELETE',
    });
  });

  it('通过独立接口导入 Z-Library Cookie 凭据', async () => {
    requestMock.mockResolvedValue({ loginStatus: 'success' });
    const payload = {
      remixUserid: '40432371',
      remixUserkey: 'private-remix-key',
      baseUrl: 'https://mirror.example',
    };

    await zlibraryApi.importCookies(payload);

    expect(requestMock).toHaveBeenCalledWith('/api/v1/user/zlibrary-config/cookies', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  });
});
