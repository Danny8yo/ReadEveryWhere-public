import { describe, expect, it } from 'vitest';
import { getBookFormat, getBookFormatLabel, getBookFormatMimeType } from '../shared/utils/bookFormat';

describe('bookFormat', () => {
  it('detects PDF and EPUB from MIME types', () => {
    expect(getBookFormat({ mimeType: 'application/pdf' })).toBe('pdf');
    expect(getBookFormat({ mimeType: 'application/epub+zip' })).toBe('epub');
  });

  it('detects MOBI and AZW3 from MIME types or file names', () => {
    expect(getBookFormat({ mimeType: 'application/x-mobipocket-ebook' })).toBe('mobi');
    expect(getBookFormat({ mimeType: 'application/vnd.amazon.ebook', fileName: 'book.azw3' })).toBe('azw3');
    expect(getBookFormat({ mimeType: 'application/octet-stream', fileName: 'book.mobi' })).toBe('mobi');
    expect(getBookFormat({ mimeType: 'application/octet-stream', fileName: 'book.azw3' })).toBe('azw3');
  });

  it('formats labels and fallback MIME types', () => {
    expect(getBookFormatLabel({ fileName: 'book.azw3' })).toBe('AZW3');
    expect(getBookFormatMimeType('mobi')).toBe('application/x-mobipocket-ebook');
  });
});
