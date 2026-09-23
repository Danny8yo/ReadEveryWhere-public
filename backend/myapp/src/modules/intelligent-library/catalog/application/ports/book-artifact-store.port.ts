export interface AllocatedBookArtifactPaths {
  storedPath: string;
  stagingStoredPath: string;
  absolutePath: string;
  stagingAbsolutePath: string;
}

export interface BookArtifactStorePort {
  allocate(ownerId: number, artifactId: string, fileName: string): AllocatedBookArtifactPaths;
  stage(content: Buffer, paths: AllocatedBookArtifactPaths): void;
  adopt(sourceAbsolutePath: string, paths: AllocatedBookArtifactPaths): void;
  toStoredPath(absolutePath: string): string;
  resolveStoredPath(storedPath: string): string;
  remove(absolutePath: string): void;
}

export const BOOK_ARTIFACT_STORE_PORT = Symbol("INTELLIGENT_LIBRARY_BOOK_ARTIFACT_STORE_PORT");
