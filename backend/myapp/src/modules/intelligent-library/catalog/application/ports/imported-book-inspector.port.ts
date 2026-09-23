export interface ImportedBookMetadata {
  title?: string;
  authors?: string[];
  isbn?: string;
  language?: string;
  description?: string;
  publisher?: string;
  publishYear?: number;
}

export interface ImportedBookInspectorPort {
  detectMimeType(buffer: Buffer, fileName: string): string | null;
  parseMetadata(buffer: Buffer): ImportedBookMetadata | null;
}

export const IMPORTED_BOOK_INSPECTOR_PORT = Symbol("INTELLIGENT_LIBRARY_IMPORTED_BOOK_INSPECTOR_PORT");
