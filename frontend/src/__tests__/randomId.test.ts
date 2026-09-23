import { afterEach, expect, it, vi } from 'vitest';
import { randomId } from '../services/randomId';
afterEach(() => vi.unstubAllGlobals());
it('uses the native UUID when available', () => {
  vi.stubGlobal('crypto', { getRandomValues: vi.fn(), randomUUID: () => 'native-id' });
  expect(randomId()).toBe('native-id');
});
it('constructs RFC UUID v4 with secure random bytes when randomUUID is absent', () => {
  const fill = vi.fn((bytes: Uint8Array) => bytes.fill(255));
  vi.stubGlobal('crypto', { getRandomValues: fill });
  expect(randomId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  expect(fill).toHaveBeenCalledTimes(1);
});
it('fails explicitly when secure randomness is unavailable', () => {
  vi.stubGlobal('crypto', {});
  expect(randomId).toThrow('安全随机数');
});
