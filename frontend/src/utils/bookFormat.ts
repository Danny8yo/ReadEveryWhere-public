export const EBOOK_FORMATS = ['pdf', 'epub', 'mobi', 'azw3'] as const;
export type EbookFormat = (typeof EBOOK_FORMATS)[number];
export type BookFormat = EbookFormat;

const extensionPattern = /\.([^.?#/]+)(?:[?#].*)?$/;

const extensionFromFileName = (fileName?: string | null): string => {
  const match = fileName?.toLowerCase().match(extensionPattern);
  return match?.[1] ?? '';
};

export const getBookFormat = (input: {
  mimeType?: string | null;
  fileName?: string | null;
}): BookFormat => {
  const mime = input.mimeType?.toLowerCase() ?? '';
  const ext = extensionFromFileName(input.fileName);

  if (mime.includes('pdf') || ext === 'pdf') return 'pdf';
  if (mime.includes('epub') || ext === 'epub') return 'epub';
  if (mime.includes('azw3') || mime.includes('amazon') || ext === 'azw3') return 'azw3';
  if (mime.includes('mobi') || mime.includes('mobipocket') || ext === 'mobi' || ext === 'azw') return 'mobi';
  return 'epub';
};

export const getBookFormatLabel = (input: {
  mimeType?: string | null;
  fileName?: string | null;
}): string => getBookFormat(input).toUpperCase();

export const getBookFormatMimeType = (format: BookFormat): string => {
  switch (format) {
    case 'pdf':
      return 'application/pdf';
    case 'epub':
      return 'application/epub+zip';
    case 'azw3':
      return 'application/vnd.amazon.ebook';
    case 'mobi':
      return 'application/x-mobipocket-ebook';
  }
};
