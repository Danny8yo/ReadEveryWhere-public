// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/metadataApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api/metadataApi')>();
  return { ...original, searchDoubanRatingCandidates: vi.fn() };
});

import DoubanRatingSection from '../ui/DoubanRatingSection.vue';
import { searchDoubanRatingCandidates } from '../api/metadataApi';

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

describe('DoubanRatingSection', () => {
  beforeEach(() => vi.mocked(searchDoubanRatingCandidates).mockReset());

  it('shows a saved rating without scraping on mount', () => {
    const wrapper = mount(DoubanRatingSection, {
      props: { initialRating: { ...candidate, fetchedAt: '2026-08-31T00:00:00.000Z' }, defaultQuery: 'Book' },
    });

    expect(wrapper.text()).toContain('8.8');
    expect(wrapper.text()).toContain('重新抓取');
    expect(searchDoubanRatingCandidates).not.toHaveBeenCalled();
  });

  it('only scrapes after an explicit query and persists the selected replacement', async () => {
    vi.mocked(searchDoubanRatingCandidates).mockResolvedValue([candidate]);
    const persistSelection = vi.fn().mockResolvedValue({ ...candidate, rating: 8.9 });
    const wrapper = mount(DoubanRatingSection, {
      props: { initialRating: candidate, defaultQuery: 'Book', persistSelection },
    });

    await wrapper.get('.douban-rating__summary button').trigger('click');
    expect(searchDoubanRatingCandidates).not.toHaveBeenCalled();
    await wrapper.get('.douban-rating__searchbar button').trigger('click');
    await vi.waitFor(() => expect(searchDoubanRatingCandidates).toHaveBeenCalledWith('Book'));
    await wrapper.get('.douban-rating__list button').trigger('click');
    await vi.waitFor(() => expect(persistSelection).toHaveBeenCalledWith(candidate));
    expect(wrapper.text()).toContain('8.9');
  });
});
