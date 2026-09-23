import { Injectable } from "@nestjs/common";
import { SqliteService } from "../../../../../../platform/persistence/sqlite/sqlite.service";
import type { CatalogBookViewQueryPort } from "../../../application/ports/catalog-book-view-query.port";
import type { LibraryBookView } from "../../../application/query-model/library-book.view";
import { parseJsonStringArray } from "../../../domain/library.utils";
import type { EbookFormat } from "../../../domain/ebook-format";

const BOOK_FORMAT_SQL = `COALESCE(
  CASE artifact.mime_type
    WHEN 'application/pdf' THEN 'pdf'
    WHEN 'application/epub+zip' THEN 'epub'
    WHEN 'application/x-mobipocket-ebook' THEN 'mobi'
    WHEN 'application/vnd.amazon.ebook' THEN 'azw3'
    ELSE NULL
  END,
  primary_source.format
)`;

interface CatalogBookViewRow {
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
  source_platform: string;
  source_book_id: string | null;
  source_url: string | null;
  publish_year: number | null;
  edition_tag: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  file_name: string | null;
  file_size: number | null;
  stored_path: string | null;
  checksum: string | null;
  mime_type: string | null;
  format: EbookFormat | null;
  profile_id: string | null;
  primary_genre: string | null;
  secondary_genres_json: string;
  traits_json: string;
  confidence_kind: "ai-score" | "user-determined" | null;
  confidence_score: number | null;
  classification_summary: string | null;
  profile_version: number;
  profile_updated_at: string;
  douban_source_book_id: string | null;
  douban_source_url: string | null;
  douban_source_title: string | null;
  douban_rating: number | null;
  douban_rating_count: number | null;
  douban_fetched_at: string | null;
}

@Injectable()
export class SqliteCatalogBookViewQuery implements CatalogBookViewQueryPort {
  constructor(private readonly sqliteService: SqliteService) {}

  getBook(userId: number, bookId: number): LibraryBookView | null {
    const row = this.sqliteService.getDatabase().prepare(`
      SELECT b.id, b.user_id, b.title, b.authors_json, b.authors_text, b.isbn, b.language, b.cover_url,
        b.description, b.publisher,
        COALESCE(primary_source.source_platform, 'manual') AS source_platform,
        primary_source.source_book_id, primary_source.source_url,
        b.publish_year, b.edition_tag, b.version, b.created_at, b.updated_at,
        artifact.file_name, artifact.file_size, artifact.stored_path, artifact.mime_type, artifact.checksum,
        ${BOOK_FORMAT_SQL} AS format,
        bp.id AS profile_id, bp.primary_genre, bp.secondary_genres_json, bp.traits_json,
        bp.confidence_kind, bp.confidence_score, bp.classification_summary,
        bp.profile_version, bp.updated_at AS profile_updated_at,
        ber.source_book_id AS douban_source_book_id,
        ber.source_url AS douban_source_url,
        ber.source_title AS douban_source_title,
        ber.rating AS douban_rating,
        ber.rating_count AS douban_rating_count,
        ber.fetched_at AS douban_fetched_at
      FROM books b
      LEFT JOIN source_refs primary_source ON primary_source.book_id = b.id AND primary_source.is_primary = 1
      LEFT JOIN book_current_artifacts current ON current.book_id = b.id
      LEFT JOIN book_artifacts artifact ON artifact.artifact_id = current.artifact_id AND artifact.status = 'active'
      LEFT JOIN book_profiles bp ON bp.book_id = b.id
      LEFT JOIN book_douban_ratings ber ON ber.book_id = b.id
      WHERE b.user_id = ? AND b.id = ?
      LIMIT 1
    `).get(userId, bookId) as unknown as CatalogBookViewRow | undefined;
    return row ? mapCatalogBookView(row) : null;
  }
}

function mapCatalogBookView(row: CatalogBookViewRow): LibraryBookView {
  requireProfile(row.profile_id, row.id);
  const isDownloaded = Boolean(
    row.stored_path,
  );
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    authors: parseJsonStringArray(row.authors_json, "books.authors_json"),
    authorsText: row.authors_text,
    isbn: row.isbn,
    language: row.language,
    coverUrl: row.cover_url,
    description: row.description,
    publisher: row.publisher,
    sourcePlatform: row.source_platform,
    sourceBookId: row.source_book_id,
    sourceUrl: row.source_url,
    publishYear: row.publish_year,
    editionTag: row.edition_tag,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fileName: row.file_name ?? null,
    fileSize: row.file_size ?? null,
    checksum: row.checksum ?? null,
    isDownloaded,
    fileUrl: isDownloaded ? `/api/v1/library/books/${row.id}/stream` : null,
    mimeType: row.mime_type ?? null,
    format: row.format,
    downloadStatus: isDownloaded ? "completed" : null,
    downloadProgress: null,
    doubanRating: row.douban_source_book_id && row.douban_source_url && row.douban_fetched_at
      ? {
          sourcePlatform: "douban",
          sourceBookId: row.douban_source_book_id,
          sourceUrl: row.douban_source_url,
          title: row.douban_source_title,
          rating: row.douban_rating,
          ratingCount: row.douban_rating_count,
          fetchedAt: row.douban_fetched_at,
        }
      : null,
    readingProfile: {
      id: row.profile_id,
      primaryGenre: row.primary_genre,
      secondaryGenres: parseJsonStringArray(row.secondary_genres_json, "book_profiles.secondary_genres_json"),
      traits: parseJsonStringArray(row.traits_json, "book_profiles.traits_json"),
      confidence: {
        kind: row.confidence_kind,
        score: row.confidence_kind === "ai-score" ? row.confidence_score : null,
      },
      classificationSummary: row.classification_summary,
      profileVersion: row.profile_version,
      updatedAt: row.profile_updated_at,
    },
  };
}

function requireProfile(profileId: string | null, bookId: number): asserts profileId is string {
  if (!profileId) throw new Error(`Book ${bookId} is missing its reading profile`);
}
