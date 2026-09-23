import type { ContentRevision } from "../book-content/domain/book-document.types";
import type { EbookFormat } from "./ebook-format";

export interface BookMetadataProjection {
  id: number;
  title: string;
  authors: string[];
  isbn: string | null;
  language: string | null;
  coverUrl: string | null;
  description: string | null;
  publisher: string | null;
  publishYear: number | null;
  editionTag: string | null;
}

export interface MetadataSectionDescriptor {
  sectionId: string;
  label: string;
  path: string;
  order: number;
  charCount: number;
}

export interface MetadataSection {
  sectionId: string;
  label: string;
  path: string;
  order: number;
  text: string;
}

export interface BookMetadataContentInspection {
  book: BookMetadataProjection;
  format: EbookFormat;
  contentRevision: ContentRevision;
  sections: readonly MetadataSectionDescriptor[];
}

export interface BookMetadataContentPort {
  inspect(userId: number, bookId: number): Promise<BookMetadataContentInspection>;
  readSections(
    userId: number,
    bookId: number,
    sectionIds: readonly string[],
    options: { maxTotalChars: number; maxCharsPerSection: number },
  ): Promise<readonly MetadataSection[]>;
}

export const BOOK_METADATA_CONTENT_PORT = Symbol("BOOK_METADATA_CONTENT_PORT");
