import { EPUB_EXTRACTOR_VERSION } from "@readeverywhere/epub-core";
import { Injectable } from "@nestjs/common";
import { extname } from "node:path";
import {
  EPUB_NORMALIZATION_VERSION,
} from "../../book-content/infrastructure/epub-document.extractor";
import { SqliteService } from "../../../../platform/persistence/sqlite/sqlite.service";
import type {
  BookAnalysisSummarySource,
  BookAnalysisSummary,
  BookAnalysisSummaryQueryPort,
} from "../application/ports/book-analysis-summary-query.port";
import { BOOK_ANALYSIS_STRATEGY_VERSION } from "../book-analysis.config";

interface ProfileSummaryRow {
  id: string;
  primary_genre: string;
  confidence: number;
  analyzed_at: string;
  status: "pending" | "applied";
}

@Injectable()
export class BookAnalysisSummaryProjector implements BookAnalysisSummaryQueryPort {
  constructor(private readonly sqlite: SqliteService) {}

  project(book: BookAnalysisSummarySource): BookAnalysisSummary | null {
    if (book.fileName && !isEpub(book)) {
      return emptySummary("unsupported", false);
    }
    if (!book.checksum || !book.fileName) return null;

    const database = this.sqlite.getDatabase();
    const revision = JSON.stringify({
      fileChecksum: `sha256:${book.checksum}`,
      extractorVersion: EPUB_EXTRACTOR_VERSION,
      normalizationVersion: EPUB_NORMALIZATION_VERSION,
    });
    const active = database.prepare(`
      SELECT status FROM book_analysis_tasks
      WHERE user_id = ? AND book_id = ? AND content_revision = ? AND strategy_version = ?
        AND status IN ('pending', 'running')
      ORDER BY created_at DESC LIMIT 1
    `).get(
      book.userId,
      book.id,
      revision,
      BOOK_ANALYSIS_STRATEGY_VERSION,
    ) as unknown as { status: "pending" | "running" } | undefined;
    if (active) return emptySummary(active.status, false);

    const profile = database.prepare(`
      SELECT id, primary_genre, confidence, analyzed_at, status
      FROM book_analysis_candidates
      WHERE user_id = ? AND book_id = ? AND content_revision = ? AND strategy_version = ?
        AND status IN ('pending', 'applied')
      ORDER BY analyzed_at DESC LIMIT 1
    `).get(
      book.userId,
      book.id,
      revision,
      BOOK_ANALYSIS_STRATEGY_VERSION,
    ) as unknown as ProfileSummaryRow | undefined;
    if (profile) {
      return {
        status: "ready",
        primaryGenre: profile.primary_genre,
        displayLabel: genreLabel(profile.primary_genre),
        confidence: profile.confidence,
        analyzedAt: profile.analyzed_at,
        stale: false,
        candidateId: profile.status === "pending" ? profile.id : null,
      };
    }

    const failed = database.prepare(`
      SELECT 1 AS found FROM book_analysis_tasks
      WHERE user_id = ? AND book_id = ? AND content_revision = ? AND strategy_version = ?
        AND status = 'failed'
      ORDER BY created_at DESC LIMIT 1
    `).get(
      book.userId,
      book.id,
      revision,
      BOOK_ANALYSIS_STRATEGY_VERSION,
    );
    if (failed) return emptySummary("failed", false);

    const latest = database.prepare(`
      SELECT content_revision, strategy_version FROM book_analysis_candidates
      WHERE user_id = ? AND book_id = ?
      ORDER BY analyzed_at DESC, created_at DESC, id DESC
      LIMIT 1
    `).get(book.userId, book.id) as unknown as {
      content_revision: string;
      strategy_version: string;
    } | undefined;
    return latest && (latest.content_revision !== revision
      || latest.strategy_version !== BOOK_ANALYSIS_STRATEGY_VERSION)
      ? emptySummary("stale", true)
      : null;
  }
}

function isEpub(book: BookAnalysisSummarySource): boolean {
  return book.mimeType === "application/epub+zip"
    || extname(book.fileName ?? "").toLowerCase() === ".epub";
}

function emptySummary(
  status: Exclude<BookAnalysisSummary["status"], "ready">,
  stale: boolean,
): BookAnalysisSummary {
  return {
    status,
    primaryGenre: null,
    displayLabel: null,
    confidence: null,
    analyzedAt: null,
    stale,
  };
}

function genreLabel(genre: string): string {
  return ({
    technical: "技术类",
    argumentation: "论证类",
    narrative: "叙事类",
    paper: "论文",
    poetry: "诗歌",
    "popular-science": "科普",
    "self-help": "自我提升",
    general: "通用",
  } as Record<string, string>)[genre] ?? genre;
}
