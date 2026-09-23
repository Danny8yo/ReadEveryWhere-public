import type { CurrentBookArtifactIdentity } from "../../../public/current-book-artifact-fence.port";
export interface BookSelectionSourcePort {
  readOwnedEpubArtifact(userId: number, bookId: number): Promise<{ buffer: Buffer; artifact: CurrentBookArtifactIdentity }>;
}
