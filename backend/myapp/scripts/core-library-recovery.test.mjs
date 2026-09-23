import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { runRecovery } from "./core-library-recovery-lib.mjs";

test("dry-run audits sources without writing the final target", () => {
  withFixture(({ identity, library, target, storageRoot, manifest }) => {
    const before = readFileSync(target);
    const result = runRecovery({
      mode: "dry-run", identitySource: identity, librarySource: library,
      target, storageRoot, email: "reader@example.test", manifest,
    });

    assert.equal(result.counts.books, 1);
    assert.equal(result.counts.sourceRefs, 1);
    assert.equal(result.files.normalizedAbsolutePaths, 1);
    assert.equal(result.files.formats.mobi, 1);
    assert.deepEqual(readFileSync(target), before);
    assert.equal(readManifest(manifest).mode, "dry-run");
  });
});

test("apply copies identity and core library rows into the final schema", () => {
  withFixture(({ identity, library, target, storageRoot, manifest }) => {
    const result = runRecovery({
      mode: "apply", identitySource: identity, librarySource: library,
      target, storageRoot, email: "reader@example.test", manifest,
    });
    assert.equal(result.status, "applied");

    const database = new DatabaseSync(target, { readOnly: true });
    assert.deepEqual(plain(database.prepare("SELECT id, email, password_hash FROM users").get()), {
      id: 7, email: "reader@example.test", password_hash: "current-hash",
    });
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM refresh_tokens").get().count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM books").get().count, 1);
    assert.deepEqual(plain(database.prepare(
      "SELECT id, format, is_primary FROM source_refs",
    ).get()), { id: 11, format: "mobi", is_primary: 1 });
    assert.deepEqual(plain(database.prepare(
      "SELECT id, book_id, primary_genre, traits_json FROM book_profiles",
    ).get()), { id: "book-41-profile", book_id: 41, primary_genre: null, traits_json: "[]" });
    assert.deepEqual(plain(database.prepare(
      "SELECT stored_path, staging_stored_path, mime_type, checksum FROM book_artifacts",
    ).get()), {
      stored_path: "7/imports/book.mobi",
      staging_stored_path: "7/.staging/book.part",
      mime_type: "application/x-mobipocket-ebook",
      checksum: result.files.audit[0].sha256,
    });
    assert.deepEqual(plain(database.prepare(`
      SELECT current.book_id, current.artifact_id, artifact.status
      FROM book_current_artifacts current
      INNER JOIN book_artifacts artifact ON artifact.artifact_id = current.artifact_id
    `).get()), { book_id: 41, artifact_id: "artifact-41", status: "active" });
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
    database.close();
  });
});

test("a checksum mismatch fails closed and leaves the target empty", () => {
  withFixture(({ identity, library, target, storageRoot, manifest }) => {
    const database = new DatabaseSync(library);
    database.prepare("UPDATE book_artifacts SET checksum = 'wrong'").run();
    database.prepare("UPDATE book_files SET checksum = 'wrong'").run();
    database.close();

    assert.throws(() => runRecovery({
      mode: "apply", identitySource: identity, librarySource: library,
      target, storageRoot, email: "reader@example.test", manifest,
    }), /Checksum mismatch/);
    const targetDatabase = new DatabaseSync(target, { readOnly: true });
    assert.equal(targetDatabase.prepare("SELECT COUNT(*) AS count FROM users").get().count, 0);
    assert.equal(targetDatabase.prepare("SELECT COUNT(*) AS count FROM books").get().count, 0);
    targetDatabase.close();
  });
});

test("an apply-time pointer failure rolls back every inserted row", () => {
  withFixture(({ identity, library, target, storageRoot, manifest }) => {
    const database = new DatabaseSync(target);
    database.exec(`
      CREATE TRIGGER reject_recovery_pointer
      BEFORE INSERT ON book_current_artifacts
      BEGIN
        SELECT RAISE(ABORT, 'fixture pointer rejection');
      END;
    `);
    database.close();

    assert.throws(() => runRecovery({
      mode: "apply", identitySource: identity, librarySource: library,
      target, storageRoot, email: "reader@example.test", manifest,
    }), /fixture pointer rejection/);
    const targetDatabase = new DatabaseSync(target, { readOnly: true });
    for (const table of ["users", "refresh_tokens", "books", "source_refs", "book_profiles", "book_artifacts", "book_current_artifacts"]) {
      assert.equal(targetDatabase.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
    }
    targetDatabase.close();
  });
});

function withFixture(run) {
  const root = mkdtempSync(join(tmpdir(), "core-library-recovery-"));
  const storageRoot = join(root, "downloads");
  const identity = join(root, "identity.sqlite");
  const library = join(root, "library.sqlite");
  const target = join(root, "target.sqlite");
  const manifest = join(root, "manifest.json");
  mkdirSync(join(storageRoot, "7", "imports"), { recursive: true });
  mkdirSync(join(storageRoot, "7", ".staging"), { recursive: true });
  writeFileSync(join(storageRoot, "7", "imports", "book.mobi"), "fixture-book-content");
  createIdentity(identity);
  createLibrary(library, storageRoot);
  createTarget(target);
  try {
    run({ root, identity, library, target, storageRoot, manifest });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function createIdentity(path) {
  const database = new DatabaseSync(path);
  database.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE refresh_tokens (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, token_hash TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE books (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL);
    INSERT INTO users VALUES (7, 'reader@example.test', 'current-hash', '2026-08-31', '2026-08-31');
    INSERT INTO refresh_tokens VALUES ('token-7', 7, 'token-hash', '2026-09-30', '2026-08-31');
  `);
  database.close();
}

function createLibrary(path, storageRoot) {
  const database = new DatabaseSync(path);
  database.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL);
    CREATE TABLE books (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, title TEXT NOT NULL,
      title_normalized TEXT NOT NULL, authors_json TEXT NOT NULL, authors_text TEXT NOT NULL,
      isbn TEXT, cover_url TEXT, description TEXT, publisher TEXT, source_platform TEXT NOT NULL,
      source_book_id TEXT, source_url TEXT, publish_year INTEGER, edition_tag TEXT,
      version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE source_refs (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, book_id INTEGER NOT NULL,
      source_platform TEXT NOT NULL, source_book_id TEXT, source_url TEXT, availability TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, hash TEXT
    );
    CREATE TABLE book_files (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, book_id INTEGER NOT NULL,
      storage_type TEXT NOT NULL, file_path TEXT NOT NULL, file_name TEXT NOT NULL,
      mime_type TEXT, file_size INTEGER, checksum TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      source_platform TEXT, source_url TEXT, local_path TEXT, download_status TEXT,
      download_error TEXT, artifact_id TEXT
    );
    CREATE TABLE book_artifacts (
      artifact_id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL, user_id INTEGER NOT NULL, book_id INTEGER NOT NULL,
      status TEXT NOT NULL, stored_path TEXT NOT NULL, staging_stored_path TEXT, file_name TEXT,
      mime_type TEXT, file_size INTEGER, checksum TEXT, source_platform TEXT, source_url TEXT,
      managed INTEGER NOT NULL, cleanup_after TEXT, cleanup_attempts INTEGER NOT NULL,
      next_cleanup_at TEXT, cleanup_lease_owner TEXT, cleanup_lease_token TEXT,
      cleanup_lease_expires_at TEXT, last_cleanup_error TEXT, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, deleted_at TEXT
    );
    INSERT INTO users VALUES (7, 'reader@example.test');
    INSERT INTO books VALUES (41, 7, 'Book', 'book', '["Author"]', 'Author', NULL, NULL, NULL, NULL,
      'zlibrary', 'source-41', 'https://example.test/41', NULL, NULL, 3, '2026-01-01', '2026-08-01');
    INSERT INTO source_refs VALUES (11, 7, 41, 'zlibrary', 'source-41', 'https://example.test/41',
      'available', '2026-01-01', '2026-08-01', 'hash-41');
  `);
  const absoluteBook = join(storageRoot, "7", "imports", "book.mobi");
  const size = readFileSync(absoluteBook).byteLength;
  const checksum = createHash("sha256").update(readFileSync(absoluteBook)).digest("hex");
  database.prepare(`
    INSERT INTO book_artifacts VALUES (
      'artifact-41', 'delivery-41', 7, 41, 'active', ?, '7/.staging/book.part', 'book.mobi',
      'application/octet-stream', ?, ?, 'zlibrary', 'https://example.test/41', 1,
      NULL, 0, NULL, NULL, NULL, NULL, NULL, '2026-01-01', '2026-08-01', NULL
    )
  `).run(absoluteBook, size, checksum);
  database.prepare(`
    INSERT INTO book_files VALUES (
      21, 7, 41, 'local', ?, 'book.mobi', 'application/octet-stream', ?, ?,
      '2026-01-01', '2026-08-01', 'zlibrary', 'https://example.test/41', ?, 'completed', NULL, 'artifact-41'
    )
  `).run(absoluteBook, size, checksum, absoluteBook);
  database.close();
}

function createTarget(path) {
  const database = new DatabaseSync(path);
  database.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE refresh_tokens (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, token_hash TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE books (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, title TEXT NOT NULL, title_normalized TEXT NOT NULL,
      authors_json TEXT NOT NULL, authors_text TEXT NOT NULL, isbn TEXT, cover_url TEXT, description TEXT,
      publisher TEXT, publish_year INTEGER, edition_tag TEXT,
      version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(id, user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE source_refs (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, book_id INTEGER NOT NULL, source_platform TEXT NOT NULL,
      source_book_id TEXT, source_url TEXT, format TEXT, is_primary INTEGER NOT NULL, hash TEXT,
      availability TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (book_id, user_id) REFERENCES books(id, user_id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX uq_source_refs_primary_book ON source_refs(book_id) WHERE is_primary=1;
    CREATE TABLE book_profiles (
      id TEXT PRIMARY KEY, book_id INTEGER NOT NULL UNIQUE, primary_genre TEXT,
      secondary_genres_json TEXT NOT NULL, traits_json TEXT NOT NULL, confidence_kind TEXT,
      confidence_score REAL, classification_summary TEXT, profile_version INTEGER NOT NULL,
      updated_at TEXT NOT NULL, FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    );
    CREATE TABLE book_artifacts (
      artifact_id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL, book_id INTEGER NOT NULL,
      status TEXT NOT NULL, stored_path TEXT NOT NULL, staging_stored_path TEXT, file_name TEXT,
      mime_type TEXT, file_size INTEGER, checksum TEXT, source_platform TEXT, source_url TEXT,
      managed INTEGER NOT NULL, cleanup_after TEXT, cleanup_attempts INTEGER NOT NULL,
      next_cleanup_at TEXT, cleanup_lease_owner TEXT, cleanup_lease_token TEXT,
      cleanup_lease_expires_at TEXT, last_cleanup_error TEXT, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE TABLE book_current_artifacts (
      book_id INTEGER PRIMARY KEY, artifact_id TEXT NOT NULL UNIQUE, activated_at TEXT NOT NULL,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
      FOREIGN KEY (artifact_id) REFERENCES book_artifacts(artifact_id) ON DELETE RESTRICT
    );
    CREATE TABLE book_douban_ratings (book_id INTEGER PRIMARY KEY);
  `);
  database.close();
}

function readManifest(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function plain(value) {
  return { ...value };
}
