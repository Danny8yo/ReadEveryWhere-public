export interface CurrentBookArtifactIdentity {
  bookId: number;
  artifactId: string;
  fileChecksum: string;
}
export const CURRENT_BOOK_ARTIFACT_FENCE_PORT = Symbol("CURRENT_BOOK_ARTIFACT_FENCE_PORT");
/** Synchronous persisted-identity check; safe inside the shared SQLite write transaction. */
export interface CurrentBookArtifactFencePort {
  current(userId: number, bookId: number): CurrentBookArtifactIdentity | null;
  assertCurrent(userId: number, expected: CurrentBookArtifactIdentity): void;
}
