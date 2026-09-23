import { randomUUID } from "node:crypto";
import type { BookArtifactRepositoryPort } from "../ports/book-artifact-repository.port";
import type { BookArtifactStorePort } from "../ports/book-artifact-store.port";

export class CollectBookArtifactsUseCase {
  constructor(
    private readonly artifacts: BookArtifactRepositoryPort,
    private readonly storage: BookArtifactStorePort,
  ) {}

  execute(input: Readonly<{ now?: string; limit?: number; workerId?: string }>): {
    claimed: number;
    deleted: number;
    failed: number;
  } {
    const now = input.now ?? new Date().toISOString();
    const expiredBefore = new Date(Date.parse(now) - 60 * 60 * 1000).toISOString();
    this.artifacts.recoverExpiredReservations(expiredBefore, now, now);
    const leaseToken = randomUUID();
    const claimed = this.artifacts.claimCollectable({
      now,
      leaseOwner: input.workerId ?? "catalog-gc",
      leaseToken,
      leaseExpiresAt: new Date(Date.parse(now) + 5 * 60 * 1000).toISOString(),
      limit: Math.max(1, Math.min(input.limit ?? 100, 1000)),
    });
    let deleted = 0;
    let failed = 0;
    for (const artifact of claimed) {
      const value = artifact.snapshot;
      try {
        if (value.managed) this.storage.remove(this.storage.resolveStoredPath(value.storedPath));
        if (this.artifacts.markDeleted(value.artifactId, leaseToken, now)) deleted += 1;
      } catch (error) {
        failed += 1;
        this.artifacts.recordCleanupFailure(
          value.artifactId,
          leaseToken,
          error instanceof Error ? error.message : "Artifact cleanup failed",
          new Date(Date.parse(now) + 60 * 60 * 1000).toISOString(),
          now,
        );
      }
    }
    return { claimed: claimed.length, deleted, failed };
  }
}
