import type { BookArtifact } from "../../domain/book-artifact";

export interface BookArtifactRepositoryPort {
  reserve(artifact: BookArtifact): void;
  activate(artifact: BookArtifact, retiredCleanupAfter: string): void;
  findById(artifactId: string): BookArtifact | null;
  findByDeliveryId(ownerId: number, deliveryId: string): BookArtifact | null;
  findCurrent(ownerId: number, bookId: number): BookArtifact | null;
  abort(artifactId: string, cleanupAfter: string, now: string): void;
  retireCurrentExact(identity: Readonly<{
    ownerId: number;
    bookId: number;
    checksum: string;
    storedPath: string;
  }>, cleanupAfter: string, now: string): boolean;
  claimCollectable(input: Readonly<{
    now: string;
    leaseOwner: string;
    leaseToken: string;
    leaseExpiresAt: string;
    limit: number;
  }>): BookArtifact[];
  markDeleted(artifactId: string, leaseToken: string, now: string): boolean;
  recordCleanupFailure(artifactId: string, leaseToken: string, error: string, nextCleanupAt: string, now: string): void;
  recoverExpiredReservations(expiredBefore: string, cleanupAfter: string, now: string): number;
}

export const BOOK_ARTIFACT_REPOSITORY_PORT = Symbol(
  "INTELLIGENT_LIBRARY_BOOK_ARTIFACT_REPOSITORY_PORT",
);
