import { beforeEach, describe, expect, it, vi } from 'vitest';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe('apiClient response parsing', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', new MemoryStorage());
  });

  it('turns an HTML upstream error page into a stable HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      '<!doctype html><title>Cloudflare error</title>',
      { status: 502, headers: { 'content-type': 'text/html; charset=UTF-8' } },
    )));
    const { request } = await import('../shared/web/apiClient');

    await expect(request('/api/v1/user/zlibrary-config')).rejects.toMatchObject({
      code: 502,
      message: '服务请求失败（HTTP 502）',
      details: { reason: 'NON_JSON_RESPONSE', status: 502 },
    });
  });

  it('keeps the backend JSON error contract unchanged', async () => {
    const backendError = { code: 50002, message: 'zlibrary login request failed' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify(backendError),
      { status: 502, headers: { 'content-type': 'application/json' } },
    )));
    const { request } = await import('../shared/web/apiClient');

    await expect(request('/api/v1/user/zlibrary-config')).rejects.toEqual(backendError);
  });
});
