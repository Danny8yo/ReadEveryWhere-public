import type { DetachCatalogBookFileCommand } from "../catalog.commands";
import type { BookArtifactStorePort } from "../ports/book-artifact-store.port";
import type { BookArtifactRepositoryPort } from "../ports/book-artifact-repository.port";

export class DetachBookFileUseCase {
  constructor(
    private readonly artifactRepository: BookArtifactRepositoryPort,
    private readonly artifacts: BookArtifactStorePort,
  ) {}

  execute(command: Readonly<DetachCatalogBookFileCommand>): void {
    const storedPath = this.artifacts.toStoredPath(command.localPath);
    this.artifactRepository.retireCurrentExact({
      ownerId: command.userId,
      bookId: command.bookId,
      checksum: command.checksum,
      storedPath,
    }, afterHours(24), new Date().toISOString());
  }
}

function afterHours(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}
