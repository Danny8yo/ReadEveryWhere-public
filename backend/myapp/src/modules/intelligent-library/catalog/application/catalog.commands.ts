import type { EbookFormat } from "../domain/ebook-format";

export interface CreateBookCommand {
  title: string;
  authors: string[];
  sourcePlatform?: string;
  sourceBookId?: string;
  sourceUrl?: string;
  coverUrl?: string;
  description?: string;
  publisher?: string;
  isbn?: string;
  language?: string;
  publishYear?: number;
  editionTag?: string;
  hash?: string;
  format?: EbookFormat;
}

export interface UpdateBookCommand {
  title?: string;
  authors?: string[];
  isbn?: string;
  language?: string;
  coverUrl?: string;
  description?: string;
  publishYear?: number;
  publisher?: string;
  editionTag?: string;
}

export interface ImportFileInput {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

export interface ImportBookCommand {
  userId: number;
  file: ImportFileInput;
  title?: string;
  authors?: string;
  isbn?: string;
  coverUrl?: string;
  conflictPolicy: "overwrite" | "skip" | "rename";
}

export interface AttachCatalogBookFileCommand {
  deliveryId?: string;
  userId: number;
  bookId: number;
  sourcePlatform: string | null;
  sourceUrl: string | null;
  localPath?: string;
  content?: Buffer;
  fileName: string;
  mimeType: string;
  fileSize: number;
  checksum: string;
}

export interface AttachedBookFileProjection {
  deliveryId: string;
  artifactId: string;
  localPath: string;
  storedPath: string;
  checksum: string;
}

export interface DetachCatalogBookFileCommand {
  userId: number;
  bookId: number;
  localPath: string;
  checksum: string;
}
