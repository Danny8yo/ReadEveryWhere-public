import { CollectBookArtifactsUseCase } from "./collect-book-artifacts.use-case";
import type { BookArtifactRepositoryPort } from "../ports/book-artifact-repository.port";
import type { BookArtifactStorePort } from "../ports/book-artifact-store.port";
import { BookArtifact } from "../../domain/book-artifact";

describe("CollectBookArtifactsUseCase", () => {
  it("deletes only managed artifacts returned by the leased claim", () => {
    const managed = artifact("managed", true);
    const legacy = artifact("legacy", false);
    const repository = fakeRepository([managed, legacy]);
    const storage = fakeStorage();
    repository.markDeleted.mockReturnValue(true);
    const useCase = new CollectBookArtifactsUseCase(repository, storage);

    expect(useCase.execute({ now: "2026-08-29T00:00:00.000Z" })).toEqual({
      claimed: 2,
      deleted: 2,
      failed: 0,
    });
    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(storage.remove).toHaveBeenCalledWith("/storage/managed.epub");
  });

  it("records a bounded cleanup failure and leaves the artifact collectable later", () => {
    const repository = fakeRepository([artifact("broken", true)]);
    const storage = fakeStorage();
    storage.remove.mockImplementation(() => { throw new Error("disk unavailable"); });
    const useCase = new CollectBookArtifactsUseCase(repository, storage);

    expect(useCase.execute({ now: "2026-08-29T00:00:00.000Z" })).toEqual({
      claimed: 1,
      deleted: 0,
      failed: 1,
    });
    expect(repository.recordCleanupFailure).toHaveBeenCalledWith(
      "broken",
      expect.any(String),
      "disk unavailable",
      "2026-08-29T01:00:00.000Z",
      "2026-08-29T00:00:00.000Z",
    );
  });
});

function artifact(artifactId: string, managed: boolean): BookArtifact {
  return BookArtifact.rehydrate({
    artifactId,
    deliveryId: `delivery-${artifactId}`,
    ownerId: 1,
    bookId: 2,
    status: "retired",
    storedPath: `1/artifacts/${artifactId}.epub`,
    stagingStoredPath: null,
    fileName: `${artifactId}.epub`,
    mimeType: "application/epub+zip",
    fileSize: 10,
    checksum: artifactId,
    sourcePlatform: null,
    sourceUrl: null,
    managed,
    cleanupAfter: "2026-08-28T00:00:00.000Z",
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
    deletedAt: null,
  });
}

function fakeRepository(claimed: BookArtifact[]): jest.Mocked<BookArtifactRepositoryPort> {
  return {
    reserve: jest.fn(),
    activate: jest.fn(),
    findById: jest.fn(),
    findByDeliveryId: jest.fn(),
    findCurrent: jest.fn(),
    abort: jest.fn(),
    retireCurrentExact: jest.fn(),
    claimCollectable: jest.fn().mockReturnValue(claimed),
    markDeleted: jest.fn(),
    recordCleanupFailure: jest.fn(),
    recoverExpiredReservations: jest.fn(),
  };
}

function fakeStorage(): jest.Mocked<BookArtifactStorePort> {
  return {
    allocate: jest.fn(),
    stage: jest.fn(),
    adopt: jest.fn(),
    toStoredPath: jest.fn(),
    resolveStoredPath: jest.fn((path: string) => {
      const parts = path.split("/");
      return `/storage/${parts[parts.length - 1]}`;
    }),
    remove: jest.fn(),
  };
}
