// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/apiClient', () => ({
  request: vi.fn(),
}));

import { request } from '../services/apiClient';
import { saveBookDoubanRating } from '../features/metadata/api/metadataApi';

describe('saveBookDoubanRating', () => {
  beforeEach(() => vi.mocked(request).mockReset());

  it('persists the selected candidate with PUT', async () => {
    vi.mocked(request).mockResolvedValue({ rating: 8.8 });
    const candidate = {
      sourcePlatform: 'douban' as const,
      sourceBookId: 'subject-42',
      sourceUrl: 'https://book.douban.com/subject/42/',
      title: 'Book',
      authors: ['Author'],
      publisher: null,
      publishYear: null,
      isbn: null,
      rating: 8.8,
      ratingCount: 1200,
    };

    await saveBookDoubanRating(42, candidate);

    expect(request).toHaveBeenCalledWith('/api/v1/metadata/books/42/douban-rating', {
      method: 'PUT',
      body: JSON.stringify(candidate),
    });
  });
});
