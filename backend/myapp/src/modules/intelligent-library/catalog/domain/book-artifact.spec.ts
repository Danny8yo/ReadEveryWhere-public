import { BookArtifact } from "./book-artifact";

describe("BookArtifact", () => {
  it("enforces the successful delivery lifecycle", () => {
    const artifact = reservedArtifact();

    artifact.markReady({
      fileName: "book.epub",
      mimeType: "application/epub+zip",
      fileSize: 42,
      checksum: "checksum-1",
    }, "2026-08-27T00:01:00.000Z");
    artifact.activate("2026-08-27T00:02:00.000Z");
    artifact.retire("2026-08-28T00:02:00.000Z", "2026-08-27T00:03:00.000Z");
    artifact.markDeleted("2026-08-28T00:03:00.000Z");

    expect(artifact.snapshot).toMatchObject({
      status: "deleted",
      checksum: "checksum-1",
      cleanupAfter: "2026-08-28T00:02:00.000Z",
      deletedAt: "2026-08-28T00:03:00.000Z",
    });
  });

  it("allows failed reserved delivery to become collectable without file metadata", () => {
    const artifact = reservedArtifact();

    artifact.abort("2026-08-28T00:00:00.000Z", "2026-08-27T00:01:00.000Z");

    expect(artifact.snapshot).toMatchObject({
      status: "aborted",
      checksum: null,
      cleanupAfter: "2026-08-28T00:00:00.000Z",
    });
  });

  it("rejects activation before ready and mutation after ready", () => {
    const artifact = reservedArtifact();

    expect(() => artifact.activate("2026-08-27T00:01:00.000Z")).toThrow(/ready/);
    artifact.markReady({
      fileName: "book.epub",
      mimeType: "application/epub+zip",
      fileSize: 42,
      checksum: "checksum-1",
    }, "2026-08-27T00:01:00.000Z");
    expect(() => artifact.markReady({
      fileName: "changed.epub",
      mimeType: "application/epub+zip",
      fileSize: 43,
      checksum: "checksum-2",
    }, "2026-08-27T00:02:00.000Z")).toThrow(/reserved/);
  });
});

function reservedArtifact(): BookArtifact {
  return BookArtifact.reserve({
    artifactId: "artifact-1",
    deliveryId: "delivery-1",
    ownerId: 1,
    bookId: 2,
    storedPath: "1/artifacts/artifact-1.epub",
    stagingStoredPath: "1/artifacts/.staging/artifact-1.part",
    sourcePlatform: "zlibrary",
    sourceUrl: "https://example.test/book",
    managed: true,
    now: "2026-08-27T00:00:00.000Z",
  });
}
