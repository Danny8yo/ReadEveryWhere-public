export const EBOOK_FORMATS = ["pdf", "epub", "mobi", "azw3"] as const;

export type EbookFormat = (typeof EBOOK_FORMATS)[number];

export const EBOOK_FORMAT_MIME_TYPES: Record<EbookFormat, string> = {
  pdf: "application/pdf",
  epub: "application/epub+zip",
  mobi: "application/x-mobipocket-ebook",
  azw3: "application/vnd.amazon.ebook",
};

export const PDF_MIME_TYPE = EBOOK_FORMAT_MIME_TYPES.pdf;

export function ebookFormatFromMimeType(mimeType: string | null): EbookFormat | null {
  if (mimeType === null) return null;
  return (Object.entries(EBOOK_FORMAT_MIME_TYPES) as Array<[EbookFormat, string]>)
    .find(([, value]) => value === mimeType)?.[0] ?? null;
}
