import { LibrarySyncState } from "../../../../library-sync/library-sync-state";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { SqliteService } from "../../../../../../platform/persistence/sqlite/sqlite.service";
import { BookArtifact } from "../../../domain/book-artifact";
import { SqliteBookArtifactRepository } from "./sqlite-book-artifact.repository";
import { SqliteBookRepository } from "./sqlite-book.repository";

describe("SqliteBookArtifactRepository", () => {
  let root: string;
  let sqlite: SqliteService;
  let sync: LibrarySyncState;
  let repository: SqliteBookArtifactRepository;

  beforeEach(() => {
    root = mkdtempSync(resolve(tmpdir(), "book-artifact-repo-"));
    process.env.SQLITE_PATH = resolve(root, "catalog.sqlite");
    sqlite = new SqliteService();
    sqlite.onModuleInit();
    sqlite.getDatabase().prepare(`
      INSERT INTO users (id, email, password_hash, created_at, updated_at)
      VALUES (1, 'artifact@example.test', 'hash', '2026-08-27', '2026-08-27')
    `).run();
    sqlite.getDatabase().prepare(`
      INSERT INTO books (
        id, user_id, title, title_normalized, authors_json, authors_text,
        version, created_at, updated_at
      ) VALUES (2, 1, 'Artifact Book', 'artifact book', '[]', '', 1, '2026-08-27', '2026-08-27')
    `).run();
    seedEmptyProfile(2);
    sync = new LibrarySyncState();
    repository = new SqliteBookArtifactRepository(sqlite, new SqliteBookRepository(sqlite, sync), sync);
  });

  afterEach(() => {
    sqlite.onApplicationShutdown();
    rmSync(root, { recursive: true, force: true });
    delete process.env.SQLITE_PATH;
  });

  it("atomically activates a new artifact, switches the pointer, and retires the old artifact", () => {
    const first = reservedArtifact("artifact-1", "delivery-1");
    repository.reserve(first);
    markReady(first, "checksum-1");
    first.activate("2026-08-27T00:02:00.000Z");
    repository.activate(first, "2026-08-28T00:02:00.000Z");

    const second = reservedArtifact("artifact-2", "delivery-2");
    repository.reserve(second);
    markReady(second, "checksum-2");
    second.activate("2026-08-27T01:02:00.000Z");
    repository.activate(second, "2026-08-28T01:02:00.000Z");

    expect(sync.version(1).revision).toBe(2);
    expect(repository.findCurrent(1, 2)?.snapshot).toMatchObject({
      artifactId: "artifact-2",
      status: "active",
      checksum: "checksum-2",
    });
    expect(repository.findById("artifact-1")?.snapshot).toMatchObject({
      status: "retired",
      cleanupAfter: "2026-08-28T01:02:00.000Z",
    });
    expect(sqlite.getDatabase().prepare(
      `SELECT current.artifact_id, artifact.checksum
       FROM book_current_artifacts current
       INNER JOIN book_artifacts artifact ON artifact.artifact_id = current.artifact_id
       WHERE current.book_id = 2`,
    ).get()).toEqual({ artifact_id: "artifact-2", checksum: "checksum-2" });
  });

  it("clears the formal profile and invalidates pending candidates for a different checksum", () => {
    const first = reservedArtifact("artifact-profile-1", "delivery-profile-1");
    repository.reserve(first);
    markReady(first, "checksum-profile-1");
    first.activate("2026-08-27T00:02:00.000Z");
    repository.activate(first, "2026-08-28T00:02:00.000Z");
    configureProfile(2, 2);
    seedCandidate("candidate-profile", 2, 2);

    const second = reservedArtifact("artifact-profile-2", "delivery-profile-2");
    repository.reserve(second);
    markReady(second, "checksum-profile-2");
    second.activate("2026-08-27T01:02:00.000Z");
    repository.activate(second, "2026-08-28T01:02:00.000Z");

    expect(profileRow(2)).toEqual({
      primary_genre: null,
      secondary_genres_json: "[]",
      traits_json: "[]",
      confidence_kind: null,
      classification_summary: null,
      profile_version: 3,
    });
    expect(sqlite.getDatabase().prepare(
      "SELECT status FROM book_analysis_candidates WHERE id = 'candidate-profile'",
    ).get()).toEqual({ status: "invalidated" });
  });

  it("switches a different artifact with the same checksum without clearing the profile", () => {
    const first = reservedArtifact("artifact-same-revision-1", "delivery-same-revision-1");
    repository.reserve(first);
    markReady(first, "checksum-same-revision");
    first.activate("2026-08-27T00:02:00.000Z");
    repository.activate(first, "2026-08-28T00:02:00.000Z");
    configureProfile(2, 2);

    const second = reservedArtifact("artifact-same-revision-2", "delivery-same-revision-2");
    repository.reserve(second);
    markReady(second, "checksum-same-revision");
    second.activate("2026-08-27T01:02:00.000Z");
    repository.activate(second, "2026-08-28T01:02:00.000Z");

    expect(repository.findCurrent(1, 2)?.snapshot.artifactId).toBe("artifact-same-revision-2");
    expect(profileRow(2)).toMatchObject({
      primary_genre: "technical",
      confidence_kind: "user-determined",
      profile_version: 2,
    });
  });

  it("keeps the current pointer unchanged when activating a duplicate checksum fails", () => {
    const otherBookId = Number(sqlite.getDatabase().prepare(`
      INSERT INTO books (
        user_id, title, title_normalized, authors_json, authors_text,
        version, created_at, updated_at
      ) VALUES (1, 'Other', 'other', '[]', '', 1, '2026-08-27', '2026-08-27')
    `).run().lastInsertRowid);
    const existing = reservedArtifact("artifact-existing", "delivery-existing", otherBookId);
    repository.reserve(existing);
    markReady(existing, "same-checksum");
    existing.activate("2026-08-27T00:02:00.000Z");
    repository.activate(existing, "2026-08-28T00:02:00.000Z");

    const current = reservedArtifact("artifact-current", "delivery-current");
    repository.reserve(current);
    markReady(current, "current-checksum");
    current.activate("2026-08-27T01:02:00.000Z");
    repository.activate(current, "2026-08-28T01:02:00.000Z");
    configureProfile(2, 2);
    const conflict = reservedArtifact("artifact-conflict", "delivery-conflict");
    repository.reserve(conflict);
    markReady(conflict, "same-checksum");
    conflict.activate("2026-08-27T02:02:00.000Z");

    expect(() => repository.activate(conflict, "2026-08-28T02:02:00.000Z"))
      .toThrow(/UNIQUE constraint failed/);
    expect(repository.findCurrent(1, 2)?.snapshot.artifactId).toBe("artifact-current");
    expect(repository.findById("artifact-current")?.snapshot.status).toBe("active");
    expect(repository.findById("artifact-conflict")?.snapshot.status).toBe("reserved");
    expect(profileRow(2)).toMatchObject({
      primary_genre: "technical",
      confidence_kind: "user-determined",
      profile_version: 2,
    });
  });

  it("recovers stale reservations as aborted records", () => {
    const artifact = reservedArtifact("artifact-stale", "delivery-stale");
    repository.reserve(artifact);

    expect(repository.recoverExpiredReservations(
      "2026-08-28T00:00:00.000Z",
      "2026-08-29T00:00:00.000Z",
      "2026-08-29T00:00:00.000Z",
    )).toBe(1);
    expect(repository.findById("artifact-stale")?.snapshot).toMatchObject({
      status: "aborted",
      cleanupAfter: "2026-08-29T00:00:00.000Z",
    });
  });

  it("claims an artifact and its cleanup lease atomically", () => {
    const artifact = reservedArtifact("artifact-claim", "delivery-claim");
    repository.reserve(artifact);
    markReady(artifact, "checksum-claim");
    artifact.activate("2026-08-27T00:02:00.000Z");
    repository.activate(artifact, "2026-08-28T00:02:00.000Z");
    sqlite.getDatabase().prepare(
      "DELETE FROM book_current_artifacts WHERE artifact_id = 'artifact-claim'",
    ).run();
    sqlite.getDatabase().prepare(`
      UPDATE book_artifacts
      SET status = 'retired', cleanup_after = '2026-08-28T00:02:00.000Z'
      WHERE artifact_id = 'artifact-claim'
    `).run();

    const first = repository.claimCollectable({
      now: "2026-08-29T00:00:00.000Z",
      leaseOwner: "worker-a",
      leaseToken: "lease-a",
      leaseExpiresAt: "2026-08-29T00:05:00.000Z",
      limit: 10,
    });
    const second = repository.claimCollectable({
      now: "2026-08-29T00:00:00.000Z",
      leaseOwner: "worker-b",
      leaseToken: "lease-b",
      leaseExpiresAt: "2026-08-29T00:05:00.000Z",
      limit: 10,
    });

    expect(first.map((item) => item.snapshot.artifactId)).toEqual(["artifact-claim"]);
    expect(second).toHaveLength(0);
    expect(repository.findById("artifact-claim")?.snapshot).toMatchObject({
      status: "retired",
      cleanupAfter: "2026-08-28T00:02:00.000Z",
    });
  });

  function reservedArtifact(
    artifactId: string,
    deliveryId: string,
    bookId = 2,
  ): BookArtifact {
    return BookArtifact.reserve({
      artifactId,
      deliveryId,
      ownerId: 1,
      bookId,
      storedPath: `1/artifacts/${artifactId}.epub`,
      stagingStoredPath: `1/artifacts/.staging/${artifactId}.part`,
      sourcePlatform: "zlibrary",
      sourceUrl: "https://example.test/book",
      managed: true,
      now: "2026-08-27T00:00:00.000Z",
    });
  }

  function markReady(artifact: BookArtifact, checksum: string): void {
    artifact.markReady({
      fileName: `${artifact.snapshot.artifactId}.epub`,
      mimeType: "application/epub+zip",
      fileSize: 42,
      checksum,
    }, "2026-08-27T00:01:00.000Z");
  }

  function seedEmptyProfile(bookId: number): void {
    sqlite.getDatabase().prepare(`
      INSERT INTO book_profiles (
        id, book_id, primary_genre, secondary_genres_json, traits_json,
        confidence_kind, confidence_score, classification_summary, profile_version, updated_at
      ) VALUES (?, ?, NULL, '[]', '[]', NULL, NULL, NULL, 1, '2026-08-27')
    `).run(`profile-${bookId}`, bookId);
  }

  function configureProfile(bookId: number, version: number): void {
    sqlite.getDatabase().prepare(`
      UPDATE book_profiles SET primary_genre = 'technical',
        secondary_genres_json = '["popular-science"]', traits_json = '["linear"]',
        confidence_kind = 'user-determined', confidence_score = NULL,
        classification_summary = 'Manual profile', profile_version = ?, updated_at = '2026-08-27T01:00:00.000Z'
      WHERE book_id = ?
    `).run(version, bookId);
  }

  function seedCandidate(id: string, bookId: number, baseProfileVersion: number): void {
    sqlite.getDatabase().prepare(`
      INSERT INTO book_analysis_candidates (
        id, user_id, book_id, primary_genre, secondary_genres_json, traits_json,
        confidence, classification_summary, content_revision, model_id, strategy_version,
        analyzed_at, base_profile_version, status, created_at, updated_at
      ) VALUES (?, 1, ?, 'technical', '[]', '[]', 0.9, 'Candidate', 'revision-1',
        'deepseek-v4-flash', 'book-profile-v1', '2026-08-27', ?, 'pending', '2026-08-27', '2026-08-27')
    `).run(id, bookId, baseProfileVersion);
  }

  function profileRow(bookId: number) {
    return sqlite.getDatabase().prepare(`
      SELECT primary_genre, secondary_genres_json, traits_json, confidence_kind,
        classification_summary, profile_version
      FROM book_profiles WHERE book_id = ?
    `).get(bookId);
  }
});
