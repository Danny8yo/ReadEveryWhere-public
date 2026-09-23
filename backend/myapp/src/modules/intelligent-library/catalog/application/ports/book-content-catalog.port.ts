export interface BookContentCatalogBookProjection {
  id: number;
  title: string;
  authors: string[];
}

export interface BookContentCatalogFileProjection {
  artifactId: string;
  checksum: string | null;
  fileName: string;
  filePath: string;
  mimeType: string | null;
  downloadStatus: string | null;
}

export interface BookContentCatalogPort {
  findById(userId: number, bookId: number): BookContentCatalogBookProjection | null;
  findReadableFile(userId: number, bookId: number): BookContentCatalogFileProjection | null;
}

export const BOOK_CONTENT_CATALOG_PORT = Symbol(
  "INTELLIGENT_LIBRARY_BOOK_CONTENT_CATALOG_PORT",
);
