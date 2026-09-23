import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  extname,
  isAbsolute,
  relative,
  resolve,
} from "node:path";
import { DatabaseSync } from "node:sqlite";

const FINAL_BOOK_COLUMNS = [
  "id", "user_id", "title", "title_normalized", "authors_json", "authors_text",
  "isbn", "cover_url", "description", "publisher", "publish_year", "edition_tag",
  "version", "created_at", "updated_at",
];

const ARTIFACT_COLUMNS = [
  "artifact_id", "delivery_id", "user_id", "book_id", "status", "stored_path",
  "staging_stored_path", "file_name", "mime_type", "file_size", "checksum",
  "source_platform", "source_url", "managed", "cleanup_after", "cleanup_attempts",
  "next_cleanup_at", "cleanup_lease_owner", "cleanup_lease_token",
  "cleanup_lease_expires_at", "last_cleanup_error", "created_at", "updated_at", "deleted_at",
];

const FORMAT_BY_EXTENSION = new Map([
  [".pdf", { format: "pdf", mimeType: "application/pdf" }],
  [".epub", { format: "epub", mimeType: "application/epub+zip" }],
  [".mobi", { format: "mobi", mimeType: "application/x-mobipocket-ebook" }],
  [".azw3", { format: "azw3", mimeType: "application/vnd.amazon.ebook" }],
]);

const FORMAT_BY_MIME = new Map(
  [...FORMAT_BY_EXTENSION.values()].map((item) => [item.mimeType, item.format]),
);

export function runRecovery(input) {
  validateInput(input);
  const identity = openReadOnly(input.identitySource);
  const library = openReadOnly(input.librarySource);
  let target;
  try {
    target = openReadOnly(input.target);
    const plan = buildPlan({ identity, library, target, input });
    target.close();
    target = undefined;

    let status = input.mode === "inspect" ? "inspected" : "validated";
    if (input.mode === "apply") {
      applyPlan(input.target, plan);
      status = "applied";
    }
    const result = buildManifest(input, plan, status);
    writeFileSync(input.manifest, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
    return result;
  } finally {
    target?.close();
    identity.close();
    library.close();
  }
}

function validateInput(input) {
  if (!input || !["inspect", "dry-run", "apply"].includes(input.mode)) {
    throw new Error("mode must be inspect, dry-run, or apply");
  }
  for (const key of ["identitySource", "librarySource", "target", "storageRoot", "email", "manifest"]) {
    if (typeof input[key] !== "string" || input[key].trim() === "") {
      throw new Error(`${key} is required`);
    }
  }
  const distinct = new Set([
    resolve(input.identitySource),
    resolve(input.librarySource),
    resolve(input.target),
  ]);
  if (distinct.size !== 3) throw new Error("identity source, library source, and target must be distinct files");
}

function openReadOnly(path) {
  return new DatabaseSync(resolve(path), { readOnly: true });
}

function buildPlan({ identity, library, target, input }) {
  assertHealthy(identity, "identity source");
  assertHealthy(library, "library source");
  assertHealthy(target, "target");
  assertFinalTarget(target);

  const identityUsers = Number(identity.prepare("SELECT COUNT(*) AS count FROM users").get().count);
  const user = identity.prepare(`
    SELECT id, email, password_hash, created_at, updated_at
    FROM users WHERE email = ?
  `).get(input.email);
  if (!user || identityUsers !== 1) {
    throw new Error(`Identity source must contain exactly the target user: email=${input.email}, users=${identityUsers}`);
  }
  const identityBooks = Number(identity.prepare("SELECT COUNT(*) AS count FROM books").get().count);
  if (identityBooks !== 0) throw new Error(`Identity source must contain zero books, found ${identityBooks}`);
  const refreshTokens = identity.prepare(`
    SELECT id, user_id, token_hash, expires_at, created_at
    FROM refresh_tokens WHERE user_id = ? ORDER BY id
  `).all(user.id).map(plain);
  if (refreshTokens.length === 0) throw new Error("Identity source contains no refresh token for the target user");

  const libraryUser = library.prepare("SELECT id, email FROM users WHERE id = ? AND email = ?")
    .get(user.id, input.email);
  if (!libraryUser) throw new Error("Library source does not contain the same user id and email");
  const books = library.prepare(`
    SELECT ${FINAL_BOOK_COLUMNS.join(", ")}
    FROM books WHERE user_id = ? ORDER BY id
  `).all(user.id).map(plain);
  if (books.length === 0) throw new Error("Library source contains no books for the target user");
  const bookIds = new Set(books.map((book) => Number(book.id)));

  const sourceRefs = library.prepare(`
    SELECT id, user_id, book_id, source_platform, source_book_id, source_url,
      hash, availability, created_at, updated_at
    FROM source_refs WHERE user_id = ? ORDER BY id
  `).all(user.id).map(plain);
  for (const source of sourceRefs) {
    if (!bookIds.has(Number(source.book_id))) {
      throw new Error(`Source ref ${source.id} points outside the target library`);
    }
  }

  const pointerRows = library.prepare(`
    SELECT
      bf.id AS pointer_id, bf.user_id AS pointer_user_id, bf.book_id AS pointer_book_id,
      bf.artifact_id AS pointer_artifact_id, bf.file_name AS pointer_file_name,
      bf.mime_type AS pointer_mime_type, bf.file_size AS pointer_file_size,
      bf.checksum AS pointer_checksum, bf.local_path AS pointer_local_path,
      bf.file_path AS pointer_file_path, bf.updated_at AS pointer_updated_at,
      ${ARTIFACT_COLUMNS.map((column) => `a.${column} AS artifact_${column}`).join(", ")}
    FROM book_files bf
    INNER JOIN book_artifacts a ON a.artifact_id = bf.artifact_id
    WHERE bf.user_id = ?
    ORDER BY bf.book_id
  `).all(user.id).map(plain);
  const pointerCount = Number(library.prepare(
    "SELECT COUNT(*) AS count FROM book_files WHERE user_id = ?",
  ).get(user.id).count);
  const activeArtifactCount = Number(library.prepare(
    "SELECT COUNT(*) AS count FROM book_artifacts WHERE user_id = ? AND status = 'active'",
  ).get(user.id).count);
  if (pointerRows.length !== pointerCount || pointerRows.length !== books.length) {
    throw new Error(`Core file closure mismatch: books=${books.length}, pointers=${pointerCount}, joined=${pointerRows.length}`);
  }
  if (activeArtifactCount !== books.length) {
    throw new Error(`Active artifact count mismatch: books=${books.length}, activeArtifacts=${activeArtifactCount}`);
  }

  const files = auditFiles(pointerRows, resolve(input.storageRoot));
  const formatByBook = new Map(files.audit.map((file) => [file.bookId, file.format]));
  const primaryIdByBook = new Map();
  for (const source of sourceRefs) {
    const bookId = Number(source.book_id);
    const current = primaryIdByBook.get(bookId);
    if (current === undefined || Number(source.id) < current) primaryIdByBook.set(bookId, Number(source.id));
  }
  const finalSourceRefs = sourceRefs.map((source) => ({
    ...source,
    format: formatByBook.get(Number(source.book_id)),
    is_primary: Number(source.id) === primaryIdByBook.get(Number(source.book_id)) ? 1 : 0,
  }));
  const profiles = books.map((book) => ({
    id: `book-${book.id}-profile`,
    book_id: book.id,
    primary_genre: null,
    secondary_genres_json: "[]",
    traits_json: "[]",
    confidence_kind: null,
    confidence_score: null,
    classification_summary: null,
    profile_version: 1,
    updated_at: book.updated_at ?? book.created_at,
  }));
  const artifacts = pointerRows.map((row) => {
    const artifact = Object.fromEntries(
      ARTIFACT_COLUMNS.map((column) => [column, row[`artifact_${column}`]]),
    );
    const audit = files.audit.find((item) => item.artifactId === artifact.artifact_id);
    return {
      ...artifact,
      stored_path: audit.storedPath,
      staging_stored_path: artifact.staging_stored_path === null
        ? null
        : normalizeStoragePath(String(artifact.staging_stored_path), resolve(input.storageRoot)),
      mime_type: audit.mimeType,
    };
  });
  const pointers = pointerRows.map((row) => ({
    book_id: row.pointer_book_id,
    artifact_id: row.pointer_artifact_id,
    activated_at: row.pointer_updated_at,
  }));

  const counts = {
    users: 1,
    refreshTokens: refreshTokens.length,
    books: books.length,
    sourceRefs: finalSourceRefs.length,
    profiles: profiles.length,
    activeArtifacts: artifacts.length,
    currentPointers: pointers.length,
  };
  assertExpectedCounts(counts, input.expectedCounts);

  return {
    user: plain(user),
    refreshTokens,
    books,
    sourceRefs: finalSourceRefs,
    profiles,
    artifacts,
    pointers,
    counts,
    files,
    ids: {
      bookIds: books.map((book) => Number(book.id)),
      sourceRefIds: finalSourceRefs.map((source) => Number(source.id)),
      artifactIds: artifacts.map((artifact) => String(artifact.artifact_id)),
    },
    sourceHashes: {
      identity: sha256File(input.identitySource),
      library: sha256File(input.librarySource),
    },
    targetSchemaFingerprint: schemaFingerprint(target),
    targetHashBefore: sha256File(input.target),
  };
}

function auditFiles(rows, storageRoot) {
  const seenBooks = new Set();
  const seenHashes = new Set();
  let normalizedAbsolutePaths = 0;
  const formats = { pdf: 0, epub: 0, mobi: 0, azw3: 0 };
  const audit = rows.map((row) => {
    const bookId = Number(row.pointer_book_id);
    if (seenBooks.has(bookId)) throw new Error(`Book ${bookId} has more than one current pointer`);
    seenBooks.add(bookId);
    if (row.artifact_status !== "active") throw new Error(`Artifact ${row.artifact_artifact_id} is not active`);
    if (Number(row.artifact_book_id) !== bookId || Number(row.artifact_user_id) !== Number(row.pointer_user_id)) {
      throw new Error(`Pointer ${row.pointer_id} does not belong to the same user and Book as its artifact`);
    }
    for (const [pointerField, artifactField] of [
      ["pointer_file_name", "artifact_file_name"],
      ["pointer_mime_type", "artifact_mime_type"],
      ["pointer_file_size", "artifact_file_size"],
      ["pointer_checksum", "artifact_checksum"],
    ]) {
      if (row[pointerField] !== row[artifactField]) {
        throw new Error(`Pointer/artifact field mismatch for Book ${bookId}: ${pointerField}`);
      }
    }
    const rawPath = String(row.artifact_stored_path);
    if (isAbsolute(rawPath)) normalizedAbsolutePaths += 1;
    const storedPath = normalizeStoragePath(rawPath, storageRoot);
    const pointerPath = normalizeStoragePath(
      String(row.pointer_local_path ?? row.pointer_file_path),
      storageRoot,
    );
    if (storedPath !== pointerPath) throw new Error(`Pointer/artifact path mismatch for Book ${bookId}`);
    const absolutePath = resolve(storageRoot, storedPath);
    const stat = statSync(absolutePath);
    if (!stat.isFile()) throw new Error(`Stored path is not a file for Book ${bookId}: ${storedPath}`);
    if (Number(row.artifact_file_size) !== stat.size) {
      throw new Error(`File size mismatch for Book ${bookId}: database=${row.artifact_file_size}, actual=${stat.size}`);
    }
    const sha256 = sha256File(absolutePath);
    if (row.artifact_checksum !== null && row.artifact_checksum !== sha256) {
      throw new Error(`Checksum mismatch for Book ${bookId}`);
    }
    if (seenHashes.has(sha256)) throw new Error(`Duplicate physical file content detected for Book ${bookId}`);
    seenHashes.add(sha256);
    const canonical = canonicalFormat(String(row.artifact_file_name), row.artifact_mime_type);
    formats[canonical.format] += 1;
    return {
      bookId,
      artifactId: String(row.artifact_artifact_id),
      storedPath,
      size: stat.size,
      sha256,
      persistedChecksum: row.artifact_checksum,
      format: canonical.format,
      mimeType: canonical.mimeType,
    };
  });
  return {
    audit,
    formats,
    normalizedAbsolutePaths,
    physicalFiles: audit.length,
    checksumsMatched: audit.filter((item) => item.persistedChecksum !== null).length,
    nullChecksumBookIds: audit.filter((item) => item.persistedChecksum === null).map((item) => item.bookId),
  };
}

function normalizeStoragePath(path, storageRoot) {
  if (!path || path === "null") throw new Error("Artifact path is missing");
  const absolute = isAbsolute(path) ? resolve(path) : resolve(storageRoot, path);
  const normalized = relative(storageRoot, absolute);
  if (!normalized || normalized === "." || normalized.startsWith("..") || isAbsolute(normalized)) {
    throw new Error(`Artifact path escapes storage root: ${path}`);
  }
  return normalized.split("\\").join("/");
}

function canonicalFormat(fileName, mimeType) {
  const byExtension = FORMAT_BY_EXTENSION.get(extname(fileName).toLowerCase());
  if (!byExtension) throw new Error(`Unsupported ebook extension: ${fileName}`);
  const byMime = mimeType === null || mimeType === "application/octet-stream"
    ? null
    : FORMAT_BY_MIME.get(String(mimeType));
  if (mimeType !== null && mimeType !== "application/octet-stream" && !byMime) {
    throw new Error(`Unsupported ebook MIME: ${mimeType}`);
  }
  if (byMime && byMime !== byExtension.format) {
    throw new Error(`Ebook extension/MIME mismatch: ${fileName} / ${mimeType}`);
  }
  return byExtension;
}

function assertFinalTarget(database) {
  for (const table of [
    "users", "refresh_tokens", "books", "source_refs", "book_profiles",
    "book_artifacts", "book_current_artifacts", "book_douban_ratings",
  ]) {
    if (!tableExists(database, table)) throw new Error(`Target is missing final table ${table}`);
  }
  for (const legacy of ["book_files", "book_external_ratings"]) {
    if (tableExists(database, legacy)) throw new Error(`Target still contains legacy table ${legacy}`);
  }
  const bookColumns = columns(database, "books");
  for (const legacy of ["source_platform", "source_book_id", "source_url"]) {
    if (bookColumns.includes(legacy)) throw new Error(`Target books still contains ${legacy}`);
  }
  for (const column of ["format", "hash", "is_primary"]) {
    if (!columns(database, "source_refs").includes(column)) {
      throw new Error(`Target source_refs is missing ${column}`);
    }
  }
  const pointerColumns = columns(database, "book_current_artifacts");
  if (pointerColumns.join(",") !== "book_id,artifact_id,activated_at") {
    throw new Error(`Target pointer shape is invalid: ${pointerColumns.join(",")}`);
  }
  for (const table of ["users", "refresh_tokens", "books", "source_refs", "book_profiles", "book_artifacts", "book_current_artifacts", "book_douban_ratings"]) {
    const count = Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
    if (count !== 0) throw new Error(`Target table ${table} must be empty, found ${count}`);
  }
}

function applyPlan(targetPath, plan) {
  const database = new DatabaseSync(resolve(targetPath));
  try {
    database.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE TRANSACTION");
    try {
      insertRows(database, "users", [plan.user], [
        "id", "email", "password_hash", "created_at", "updated_at",
      ]);
      insertRows(database, "refresh_tokens", plan.refreshTokens, [
        "id", "user_id", "token_hash", "expires_at", "created_at",
      ]);
      insertRows(database, "books", plan.books, FINAL_BOOK_COLUMNS);
      insertRows(database, "source_refs", plan.sourceRefs, [
        "id", "user_id", "book_id", "source_platform", "source_book_id", "source_url",
        "format", "is_primary", "hash", "availability", "created_at", "updated_at",
      ]);
      insertRows(database, "book_profiles", plan.profiles, [
        "id", "book_id", "primary_genre", "secondary_genres_json", "traits_json",
        "confidence_kind", "confidence_score", "classification_summary", "profile_version", "updated_at",
      ]);
      insertRows(database, "book_artifacts", plan.artifacts, ARTIFACT_COLUMNS);
      insertRows(database, "book_current_artifacts", plan.pointers, [
        "book_id", "artifact_id", "activated_at",
      ]);
      const foreignKeyRows = database.prepare("PRAGMA foreign_key_check").all();
      if (foreignKeyRows.length > 0) throw new Error(`Target foreign key check failed: ${JSON.stringify(foreignKeyRows)}`);
      assertAppliedCounts(database, plan.counts);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    database.prepare("PRAGMA wal_checkpoint(TRUNCATE)").all();
  } finally {
    database.close();
  }
}

function insertRows(database, table, rows, columnsToWrite) {
  if (rows.length === 0) return;
  const placeholders = columnsToWrite.map(() => "?").join(", ");
  const statement = database.prepare(
    `INSERT INTO ${table} (${columnsToWrite.join(", ")}) VALUES (${placeholders})`,
  );
  for (const row of rows) statement.run(...columnsToWrite.map((column) => row[column]));
}

function assertAppliedCounts(database, counts) {
  const expectations = [
    ["users", counts.users],
    ["refresh_tokens", counts.refreshTokens],
    ["books", counts.books],
    ["source_refs", counts.sourceRefs],
    ["book_profiles", counts.profiles],
    ["book_artifacts", counts.activeArtifacts],
    ["book_current_artifacts", counts.currentPointers],
  ];
  for (const [table, expected] of expectations) {
    const actual = Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
    if (actual !== expected) throw new Error(`Applied count mismatch for ${table}: expected=${expected}, actual=${actual}`);
  }
  const brokenPointers = Number(database.prepare(`
    SELECT COUNT(*) AS count
    FROM book_current_artifacts current
    LEFT JOIN book_artifacts artifact ON artifact.artifact_id = current.artifact_id
    WHERE artifact.artifact_id IS NULL OR artifact.status != 'active' OR artifact.book_id != current.book_id
  `).get().count);
  if (brokenPointers !== 0) throw new Error(`Applied pointer closure is invalid: ${brokenPointers}`);
}

function assertExpectedCounts(counts, expected) {
  if (!expected) return;
  for (const [key, value] of Object.entries(expected)) {
    if (counts[key] !== value) {
      throw new Error(`Expected ${key}=${value}, found ${counts[key]}`);
    }
  }
}

function buildManifest(input, plan, status) {
  return {
    schemaVersion: 1,
    mode: input.mode,
    status,
    createdAt: new Date().toISOString(),
    gitRevision: gitRevision(),
    identity: {
      userId: Number(plan.user.id),
      email: String(plan.user.email),
      refreshTokens: plan.refreshTokens.length,
    },
    sources: {
      identity: { path: resolve(input.identitySource), sha256: plan.sourceHashes.identity },
      library: { path: resolve(input.librarySource), sha256: plan.sourceHashes.library },
    },
    target: {
      path: resolve(input.target),
      schemaFingerprint: plan.targetSchemaFingerprint,
      sha256Before: plan.targetHashBefore,
      sha256After: sha256File(input.target),
    },
    counts: plan.counts,
    ids: plan.ids,
    files: plan.files,
  };
}

function assertHealthy(database, label) {
  const integrity = database.prepare("PRAGMA integrity_check").get();
  if (!integrity || Object.values(integrity)[0] !== "ok") {
    throw new Error(`${label} integrity_check failed`);
  }
  const foreignKeys = database.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeys.length > 0) throw new Error(`${label} foreign_key_check failed: ${foreignKeys.length}`);
}

function schemaFingerprint(database) {
  const rows = database.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `).all().map(plain);
  return sha256(JSON.stringify(rows));
}

function tableExists(database, table) {
  return Boolean(database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
  ).get(table));
}

function columns(database, table) {
  return database.prepare(`PRAGMA table_info(${table})`).all().map((row) => String(row.name));
}

function sha256File(path) {
  return sha256(readFileSync(resolve(path)));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function gitRevision() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function plain(value) {
  return { ...value };
}
