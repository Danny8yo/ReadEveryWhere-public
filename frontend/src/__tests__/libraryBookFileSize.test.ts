import { describe, expect, it } from 'vitest';
import { toLibraryDetail } from '../features/book-detail/domain/detail';
import type { LibraryBook } from '../features/library/model/library';

const book = (fileSize: number | null): LibraryBook => ({
  id: 42,
  userId: 1,
  title: '真实文件大小',
  authors: ['测试作者'],
  authorsText: '测试作者',
  isbn: null,
  language: 'zh-CN',
  coverUrl: null,
  description: null,
  publisher: null,
  sourcePlatform: 'manual',
  sourceBookId: null,
  sourceUrl: null,
  publishYear: null,
  editionTag: null,
  version: 1,
  createdAt: '2026-09-03T00:00:00.000Z',
  updatedAt: '2026-09-03T00:00:00.000Z',
  fileSize,
  isDownloaded: fileSize !== null,
  format: fileSize === null ? null : 'epub',
  doubanRating: null,
});

describe('toLibraryDetail 文件大小', () => {
  it('保留当前 artifact 的真实字节数并生成显示文本', () => {
    const result = toLibraryDetail(book(1536));
    expect(result.fileSize).toBe(1536);
    expect(result.fileSizeText).toBe('1.5 KB');
  });

  it('无 current artifact 时显示未知大小', () => {
    const result = toLibraryDetail(book(null));
    expect(result.fileSize).toBeNull();
    expect(result.fileSizeText).toBe('未知大小');
  });
});
