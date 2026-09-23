import { LIBRARY_PROJECTION_CHANGE_PORT, type LibraryProjectionChangePort } from "../../../../public/library-projection-change.port";
import { afterCommit, transact } from "../../../../../../platform/persistence/sqlite/transaction";
import { Inject, Injectable } from "@nestjs/common";
import { DatabaseSync } from "node:sqlite";
import { SqliteService } from "../../../../../../platform/persistence/sqlite/sqlite.service";
import { withSqliteRetry } from "../../../../../../platform/persistence/sqlite/sqlite-retry";
import type {
  BookRepositoryPort,
  BookSaveResult,
} from "../../../application/ports/book-repository.port";
import { Book, BookId } from "../../../domain/book";
import type { BookReadingProfileJSON } from "../../../domain/book-reading-profile";
import type { EbookFormat } from "../../../domain/ebook-format";
import { normalizeTitle, parseJsonStringArray } from "../../../domain/library.utils";

interface BookPersistenceRow {
  id: number;
  user_id: number;
  title: string;
  authors_json: string;
  authors_text: string;
  isbn: string | null;
  language: string | null;
  cover_url: string | null;
  description: string | null;
  publisher: string | null;
  publish_year: number | null;
  edition_tag: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

interface SourceReferenceRow {
  id?: number;
  source_platform: string;
  source_book_id: string | null;
  source_url: string | null;
  hash: string | null;
  format: EbookFormat | null;
  availability: string;
}

interface BookProfileRow {
  id: string;
  primary_genre: BookReadingProfileJSON["primaryGenre"];
  secondary_genres_json: string;
  traits_json: string;
  confidence_kind: string | null;
  confidence_score: number | null;
  classification_summary: string | null;
  profile_version: number;
  updated_at: string;
}

@Injectable()
export class SqliteBookRepository implements BookRepositoryPort {
  constructor(private readonly sqliteService: SqliteService, @Inject(LIBRARY_PROJECTION_CHANGE_PORT) private readonly changes: LibraryProjectionChangePort) {}

  isOwnedBy(ownerId: number, bookId: BookId): boolean {
    return Boolean(this.sqliteService.getDatabase().prepare(
      "SELECT 1 FROM books WHERE user_id = ? AND id = ? LIMIT 1",
    ).get(ownerId, bookId));
  }

  findById(ownerId: number, bookId: BookId): Book | null {
    const database = this.sqliteService.getDatabase();
    const row = database.prepare(`
      SELECT id, user_id, title, authors_json, authors_text, isbn, language, cover_url, description,
        publisher, publish_year, edition_tag, version,
        created_at, updated_at
      FROM books
      WHERE user_id = ? AND id = ?
      LIMIT 1
    `).get(ownerId, bookId) as unknown as BookPersistenceRow | undefined;
    if (!row) return null;
    const sources = database.prepare(`
      SELECT source_platform, source_book_id, source_url, hash, format, availability
      FROM source_refs
      WHERE user_id = ? AND book_id = ?
      ORDER BY is_primary DESC, id ASC
    `).all(ownerId, bookId) as unknown as SourceReferenceRow[];
    const profile = database.prepare(`
      SELECT id, primary_genre, secondary_genres_json, traits_json, confidence_kind,
        confidence_score, classification_summary, profile_version, updated_at
      FROM book_profiles WHERE book_id = ? LIMIT 1
    `).get(bookId) as unknown as BookProfileRow | undefined;
    if (!profile) throw new Error(`Book ${bookId} is missing its reading profile`);
    return Book.rehydrate({
      id: row.id,
      ownerId: row.user_id,
      metadata: {
        title: row.title,
        authors: parseJsonStringArray(row.authors_json, "books.authors_json"),
        isbn: row.isbn,
        language: row.language,
        coverUrl: row.cover_url,
        description: row.description,
        publisher: row.publisher,
        publishYear: row.publish_year,
        editionTag: row.edition_tag,
      },
      authorsText: row.authors_text,
      sourceReferences: sources.map((source) => ({
        platform: source.source_platform,
        sourceBookId: source.source_book_id,
        sourceUrl: source.source_url,
        hash: source.hash,
        format: source.format,
        availability: source.availability,
      })),
      readingProfile: mapProfile(profile),
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  insert(book: Book): BookId {
    if (book.id !== null) throw new Error("Cannot insert an existing Book");
    const database = this.sqliteService.getDatabase();
    let bookId = 0;
    this.transaction(database, () => {
      const metadata = book.metadata;
      const result = database.prepare(`
        INSERT INTO books (
          user_id, title, title_normalized, authors_json, authors_text,
          isbn, language, cover_url, description, publisher,
          publish_year, edition_tag,
          version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        book.ownerId,
        metadata.title,
        normalizeTitle(metadata.title),
        JSON.stringify(metadata.authors),
        book.authorsTextForPersistence,
        metadata.isbn,
        metadata.language,
        metadata.coverUrl,
        metadata.description,
        metadata.publisher,
        metadata.publishYear,
        metadata.editionTag,
        book.version,
        book.createdAt,
        book.updatedAt,
      );
      bookId = Number(result.lastInsertRowid);
      for (const [index, source] of book.sourceReferences.entries()) {
        database.prepare(`
          INSERT INTO source_refs (
            user_id, book_id, source_platform, source_book_id, source_url,
            hash, format, is_primary, availability, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          book.ownerId,
          bookId,
          source.platform,
          source.sourceBookId,
          source.sourceUrl,
          source.hash,
          source.format,
          index === 0 ? 1 : 0,
          source.availability,
          book.createdAt,
          book.updatedAt,
        );
      }
      this.upsertProfile(database, book, bookId);
      afterCommit(database, () => this.changes.changed(book.ownerId));
    });
    return bookId;
  }

  save(book: Book, expectedVersion: number): BookSaveResult {
    if (book.id === null) throw new Error("Cannot save a new Book");
    const database = this.sqliteService.getDatabase();
    let outcome: BookSaveResult = "not_found";
    this.transaction(database, () => {
      outcome = this.saveWithinTransaction(database, book, expectedVersion);
      if (outcome === "saved") afterCommit(database, () => this.changes.changed(book.ownerId));
    });
    return outcome;
  }

  clearReadingProfileForFileReplacement(ownerId: number, bookId: BookId, now: string): void {
    const database = this.sqliteService.getDatabase();
    const book = this.findById(ownerId, bookId);
    if (!book) throw new Error("Book not found while replacing its current file");
    const expectedVersion = book.version;
    book.clearReadingProfile("file-replacement", now);
    const outcome = this.saveWithinTransaction(database, book, expectedVersion);
    if (outcome !== "saved") {
      throw new Error(`Book changed while replacing its current file: ${outcome}`);
    }
  }

  private saveWithinTransaction(
    database: DatabaseSync,
    book: Book,
    expectedVersion: number,
  ): BookSaveResult {
    if (book.id === null) throw new Error("Cannot save a new Book");
    const metadata = book.metadata;
    const result = database.prepare(`
        UPDATE books
        SET title = ?, title_normalized = ?, authors_json = ?, authors_text = ?,
          isbn = ?, language = ?, cover_url = ?, description = ?, publisher = ?,
          publish_year = ?, edition_tag = ?, version = ?, updated_at = ?
        WHERE user_id = ? AND id = ? AND version = ?
    `).run(
        metadata.title,
        normalizeTitle(metadata.title),
        JSON.stringify(metadata.authors),
        book.authorsTextForPersistence,
        metadata.isbn,
        metadata.language,
        metadata.coverUrl,
        metadata.description,
        metadata.publisher,
        metadata.publishYear,
        metadata.editionTag,
        book.version,
        book.updatedAt,
        book.ownerId,
        book.id,
        expectedVersion,
    );
    if (Number(result.changes) === 0) {
      const exists = database.prepare(
        "SELECT 1 FROM books WHERE user_id = ? AND id = ? LIMIT 1",
      ).get(book.ownerId, book.id);
      return exists ? "conflict" : "not_found";
    }
    this.synchronizeSourceReferences(database, book);
    this.upsertProfile(database, book, book.id);
    return "saved";
  }

  delete(ownerId: number, bookId: BookId): boolean {
    const result = this.sqliteService.getDatabase().prepare(
      "DELETE FROM books WHERE user_id = ? AND id = ?",
    ).run(ownerId, bookId);
    const changed = Number(result.changes) > 0;
    if (changed) afterCommit(this.sqliteService.getDatabase(), () => this.changes.changed(ownerId));
    return changed;
  }

  findOwnedIds(ownerId: number, bookIds: BookId[]): BookId[] {
    if (bookIds.length === 0) return [];
    const placeholders = bookIds.map(() => "?").join(", ");
    const rows = this.sqliteService.getDatabase().prepare(`
      SELECT id FROM books WHERE user_id = ? AND id IN (${placeholders})
    `).all(ownerId, ...bookIds) as unknown as Array<{ id: number }>;
    return rows.map((row) => row.id);
  }

  deleteMany(ownerId: number, bookIds: BookId[]): void {
    if (bookIds.length === 0) return;
    const placeholders = bookIds.map(() => "?").join(", ");
    this.sqliteService.getDatabase().prepare(`
      DELETE FROM books WHERE user_id = ? AND id IN (${placeholders})
    `).run(ownerId, ...bookIds);
  }

  private synchronizeSourceReferences(database: DatabaseSync, book: Book): void {
    if (book.id === null) throw new Error("Cannot synchronize sources for a new Book");
    if (book.sourceReferences.length === 0) {
      database.prepare("DELETE FROM source_refs WHERE user_id = ? AND book_id = ?")
        .run(book.ownerId, book.id);
      return;
    }
    const existing = database.prepare(`
      SELECT id, source_platform, source_book_id, source_url, hash, format, availability
      FROM source_refs
      WHERE user_id = ? AND book_id = ?
      ORDER BY is_primary DESC, id ASC
    `).all(book.ownerId, book.id) as unknown as Array<SourceReferenceRow & { id: number }>;
    const existingByIdentity = new Map(
      existing.map((source) => [sourceIdentity(source.source_platform, source.source_book_id), source]),
    );
    const retainedIds: number[] = [];
    database.prepare(`
      UPDATE source_refs SET is_primary = 0
      WHERE user_id = ? AND book_id = ? AND is_primary = 1
    `).run(book.ownerId, book.id);

    for (const [index, source] of book.sourceReferences.entries()) {
      const current = existingByIdentity.get(sourceIdentity(source.platform, source.sourceBookId));
      if (current) {
        database.prepare(`
          UPDATE source_refs
          SET source_url = ?, hash = ?, format = ?, is_primary = ?, availability = ?, updated_at = ?
          WHERE id = ? AND user_id = ? AND book_id = ?
        `).run(
          source.sourceUrl,
          source.hash,
          source.format,
          index === 0 ? 1 : 0,
          source.availability,
          book.updatedAt,
          current.id,
          book.ownerId,
          book.id,
        );
        retainedIds.push(current.id);
        continue;
      }
      const result = database.prepare(`
        INSERT INTO source_refs (
          user_id, book_id, source_platform, source_book_id, source_url,
          hash, format, is_primary, availability, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        book.ownerId,
        book.id,
        source.platform,
        source.sourceBookId,
        source.sourceUrl,
        source.hash,
        source.format,
        index === 0 ? 1 : 0,
        source.availability,
        book.updatedAt,
        book.updatedAt,
      ) as { lastInsertRowid?: number | bigint };
      const insertedId = (result as { lastInsertRowid?: number | bigint }).lastInsertRowid;
      if (insertedId === undefined) {
        throw new Error("source_refs insert did not return a row id");
      }
      retainedIds.push(Number(insertedId));
    }

    const placeholders = retainedIds.map(() => "?").join(", ");
    database.prepare(`
      DELETE FROM source_refs
      WHERE user_id = ? AND book_id = ? AND id NOT IN (${placeholders})
    `).run(book.ownerId, book.id, ...retainedIds);
  }

  private upsertProfile(database: DatabaseSync, book: Book, bookId: number | null): void {
    if (bookId === null) throw new Error("Cannot persist profile for a new Book");
    const profile = book.readingProfile;
    const confidenceKind = profile.confidence?.kind ?? null;
    const confidenceScore = profile.confidence?.kind === "ai-score" ? profile.confidence.score : null;
    database.prepare(`
      INSERT INTO book_profiles (
        id, book_id, primary_genre, secondary_genres_json, traits_json,
        confidence_kind, confidence_score, classification_summary, profile_version, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(book_id) DO UPDATE SET
        id = excluded.id, primary_genre = excluded.primary_genre,
        secondary_genres_json = excluded.secondary_genres_json,
        traits_json = excluded.traits_json, confidence_kind = excluded.confidence_kind,
        confidence_score = excluded.confidence_score,
        classification_summary = excluded.classification_summary,
        profile_version = excluded.profile_version, updated_at = excluded.updated_at
    `).run(
      profile.id,
      bookId,
      profile.primaryGenre,
      JSON.stringify(profile.secondaryGenres),
      JSON.stringify(profile.traits),
      confidenceKind,
      confidenceScore,
      profile.classificationSummary,
      profile.profileVersion,
      profile.updatedAt,
    );
  }

  private transaction(database: DatabaseSync, callback: () => void): void {
    withSqliteRetry(() => transact(database, callback));
  }

}

function sourceIdentity(platform: string, sourceBookId: string | null): string {
  return `${platform}\u0000${sourceBookId ?? ""}`;
}

function mapProfile(row: BookProfileRow): BookReadingProfileJSON {
  const confidence = mapProfileConfidence(row);
  return {
    id: row.id,
    primaryGenre: row.primary_genre,
    secondaryGenres: parseJsonStringArray(row.secondary_genres_json, "book_profiles.secondary_genres_json") as BookReadingProfileJSON["secondaryGenres"],
    traits: parseJsonStringArray(row.traits_json, "book_profiles.traits_json"),
    confidence,
    classificationSummary: row.classification_summary,
    profileVersion: row.profile_version,
    updatedAt: row.updated_at,
  };
}

function mapProfileConfidence(row: BookProfileRow): BookReadingProfileJSON["confidence"] {
  if (row.confidence_kind === null) {
    if (row.confidence_score !== null) {
      throw new Error("book_profiles.confidence_score must be NULL for empty profiles");
    }
    return null;
  }
  if (row.confidence_kind === "user-determined") {
    if (row.confidence_score !== null) {
      throw new Error("book_profiles.confidence_score must be NULL for user-determined profiles");
    }
    return { kind: "user-determined" };
  }
  if (row.confidence_kind !== "ai-score") {
    throw new Error(`book_profiles.confidence_kind is invalid: ${row.confidence_kind}`);
  }
  if (row.confidence_score === null
    || !Number.isFinite(row.confidence_score)
    || row.confidence_score < 0
    || row.confidence_score > 1) {
    throw new Error("book_profiles.confidence_score is required for ai-score profiles");
  }
  return { kind: "ai-score", score: row.confidence_score };
}
