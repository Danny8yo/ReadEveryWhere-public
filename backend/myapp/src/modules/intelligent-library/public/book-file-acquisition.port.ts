export interface ExistingBookFileQuery {
  userId: number;
  bookId: number;
}

export interface ExistingBookFileProjection {
  absolutePath: string;
  storedPath: string;
}

export interface BookFileStatusQueryPort {
  findExisting(query: Readonly<ExistingBookFileQuery>): ExistingBookFileProjection | null;
}

export interface AttachBookFileCommand {
  deliveryId?: string;
  userId: number;
  bookId: number;
  sourcePlatform: string;
  sourceUrl: string;
  localPath?: string;
  content?: Buffer;
  fileName: string;
  mimeType: string;
  fileSize: number;
  checksum: string;
}

export interface AttachBookFilePort {
  // 异步：PDF 落库前要先重建页树（见 PdfPageTreeOptimizerPort）。
  attach(command: Readonly<AttachBookFileCommand>): Promise<AttachedBookFileProjection>;
  detach(command: Readonly<DetachBookFileCommand>): void;
}

export interface AttachedBookFileProjection {
  deliveryId: string;
  artifactId: string;
  localPath: string;
  storedPath: string;
  checksum: string;
}

export interface DetachBookFileCommand {
  userId: number;
  bookId: number;
  localPath: string;
  checksum: string;
}

export const BOOK_FILE_STATUS_QUERY_PORT = Symbol(
  "INTELLIGENT_LIBRARY_BOOK_FILE_STATUS_QUERY_PORT",
);
export const ATTACH_BOOK_FILE_PORT = Symbol(
  "INTELLIGENT_LIBRARY_ATTACH_BOOK_FILE_PORT",
);
