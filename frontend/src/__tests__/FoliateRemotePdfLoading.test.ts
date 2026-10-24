// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';

const { makePDF } = vi.hoisted(() => ({
  makePDF: vi.fn(),
}));

vi.mock('../vendor/foliate-js/pdf.js', () => ({ makePDF }));

import { makeBook } from '../vendor/foliate-js/view.js';

describe('Foliate remote PDF loading', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('passes a remote URL directly to pdf.js without downloading a Blob first', async () => {
    const url = 'https://reader.example.test/api/v1/library/books/42/file?token=signed';
    const pdfBook = { metadata: { title: 'Remote PDF' } };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      url,
      blob: vi.fn().mockResolvedValue(new Blob(['%PDF-1.7\n'])),
    });
    vi.stubGlobal('fetch', fetchMock);
    makePDF.mockResolvedValue(pdfBook);

    await expect(makeBook(url)).resolves.toBe(pdfBook);

    expect(makePDF).toHaveBeenCalledOnce();
    expect(makePDF).toHaveBeenCalledWith(url);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
