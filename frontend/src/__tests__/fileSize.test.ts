import { describe, expect, it } from 'vitest';
import { formatFileSize } from '../shared/utils/fileSize';

describe('formatFileSize', () => {
  it.each([
    [null, '未知大小'],
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1 KB'],
    [1536, '1.5 KB'],
    [1024 * 1024, '1 MB'],
    [1024 * 1024 * 1024, '1 GB'],
  ])('将 %s 字节格式化为 %s', (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected);
  });
});
