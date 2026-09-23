export interface ImportedFileStorePort {
  pathForImport(ownerId: number, fileName: string): string;
  stagingPathForImport(ownerId: number, fileName: string): string;
  exists(absolutePath: string): boolean;
  write(absolutePath: string, content: Buffer): void;
  remove(absolutePath: string): void;
}

export const IMPORTED_FILE_STORE_PORT = Symbol("INTELLIGENT_LIBRARY_IMPORTED_FILE_STORE_PORT");
