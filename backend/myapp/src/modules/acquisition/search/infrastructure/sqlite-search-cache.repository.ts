import { Injectable } from "@nestjs/common";
import { SqliteService } from "../../../../platform/persistence/sqlite/sqlite.service";
import type { SearchPageResult } from "../domain/search-result.types";
import type { SearchCacheKey, SearchCachePort } from "../application/ports/search-cache.port";

@Injectable()
export class SqliteSearchCacheRepository implements SearchCachePort {
  constructor(private readonly sqliteService: SqliteService) {}

  find(key: Readonly<SearchCacheKey>, ttlMs: number): SearchPageResult | null {
    const database = this.sqliteService.getDatabase();
    const expiry = new Date(Date.now() - ttlMs).toISOString();
    try {
      database.prepare(`
        DELETE FROM search_cache
        WHERE keyword = ? AND source_platform = ? AND updated_at < ?
      `).run(key.keyword, key.sourcePlatform, expiry);
    } catch {
      // Cache cleanup is best-effort.
    }

    const row = database.prepare(`
      SELECT results FROM search_cache
      WHERE keyword = ? AND source_platform = ? AND formats_json = ? AND page = ? AND page_size = ?
    `).get(key.keyword, key.sourcePlatform, formatsKey(key.formats), key.page, key.pageSize) as unknown as
      | { results: string }
      | undefined;
    if (!row) return null;
    try {
      const cached = JSON.parse(row.results) as SearchPageResult;
      for (const item of cached.items) {
        if (!item.fileSizeText && item.fileSize != null) item.fileSizeText = formatFileSize(item.fileSize);
        item.zlibraryInterestScore ??= null;
        item.zlibraryQualityScore ??= null;
      }
      return cached;
    } catch {
      return null;
    }
  }

  save(key: Readonly<SearchCacheKey>, result: Readonly<SearchPageResult>): void {
    try {
      this.sqliteService.getDatabase().prepare(`
        INSERT OR REPLACE INTO search_cache (
          keyword, source_platform, formats_json, page, page_size, results, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        key.keyword,
        key.sourcePlatform,
        formatsKey(key.formats),
        key.page,
        key.pageSize,
        JSON.stringify(result),
        new Date().toISOString(),
      );
    } catch {
      // Cache writes never fail the search request.
    }
  }
}

function formatsKey(formats: readonly string[]): string {
  return JSON.stringify([...formats].sort());
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}
