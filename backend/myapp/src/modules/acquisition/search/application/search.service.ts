import { AcquisitionError } from "../../domain/acquisition.error";
import type { RawSearchItem, SourcePlatform, SourceSettingsQueryPort } from "../../public";
import { SourceRegistry } from "../../source-registry/application/source-registry";
import type { SearchPageResult, SearchResultItem } from "../domain/search-result.types";
import type { SearchCachePort } from "./ports/search-cache.port";
import type { EbookFormat } from "../../../intelligent-library/public/ebook-format";

export interface SearchBooksQuery {
  keyword: string;
  page: number;
  pageSize: number;
  sourcePlatform: SourcePlatform | "all";
  formats: EbookFormat[];
}

export class SearchService {
  constructor(
    private readonly cache: SearchCachePort,
    private readonly sources: SourceRegistry,
    private readonly settings: SourceSettingsQueryPort,
    private readonly cacheTtlMs: number,
  ) {}

  async searchBooks(query: SearchBooksQuery, requestId: string, userId?: number): Promise<SearchPageResult> {
    const cached = this.cache.find(query, this.cacheTtlMs);
    if (cached) return { ...cached, requestId };

    const activeSources = this.sources.searchesFor(query.sourcePlatform);
    if (activeSources.length === 0) {
      return emptyResult(query, requestId, ["No search providers available"]);
    }

    const baseUrl = this.settings.resolveBaseUrl({ sourcePlatform: "zlibrary", userId });
    const unavailable: string[] = [];
    const allResults: Array<{ item: RawSearchItem; platform: string }> = [];
    let total = 0;

    for (const source of activeSources) {
      if (!source.isAvailable()) {
        unavailable.push(source.platform);
        continue;
      }
      try {
        const result = await source.searchBooks(
          query.keyword,
          query.page,
          query.pageSize,
          requestId,
          baseUrl,
          query.formats,
        );
        total += result.total;
        result.items.forEach((item) => allResults.push({ item, platform: source.platform }));
      } catch {
        unavailable.push(source.platform);
      }
    }

    if (allResults.length === 0 && unavailable.length === activeSources.length) {
      throw AcquisitionError.upstream("搜索失败，请检查网络后重试");
    }

    const offset = (query.page - 1) * query.pageSize;
    const hasNext = offset + query.pageSize < total;
    const result: SearchPageResult = {
      items: mergeAndDeduplicate(allResults),
      total,
      page: query.page,
      pageSize: query.pageSize,
      hasNext,
      nextPage: hasNext ? query.page + 1 : null,
      requestId,
      warnings: unavailable.length > 0 && unavailable.length < activeSources.length
        ? ["部分书源当前不可用，结果可能不完整"]
        : [],
    };
    this.cache.save(query, result);
    return result;
  }
}

function emptyResult(query: SearchBooksQuery, requestId: string, warnings: string[]): SearchPageResult {
  return {
    items: [], total: 0, page: query.page, pageSize: query.pageSize,
    hasNext: false, nextPage: null, requestId, warnings,
  };
}

function mergeAndDeduplicate(
  entries: Array<{ item: RawSearchItem; platform: string }>,
): SearchResultItem[] {
  const grouped = new Map<string, { item: RawSearchItem; platforms: Set<string> }>();
  for (const { item, platform } of entries) {
    const key = dedupKey(item);
    const existing = grouped.get(key);
    if (existing) existing.platforms.add(platform);
    else grouped.set(key, { item, platforms: new Set([platform]) });
  }

  return [...grouped.values()].map(({ item, platforms }) => {
    const platform = [...platforms][0] as SearchResultItem["sourcePlatform"];
    return {
      id: `${platform}:${item.sourceBookId}`,
      sourceBookId: item.sourceBookId,
      sourcePlatform: platform,
      title: item.title,
      authors: item.authors,
      publisher: item.publisher,
      publishYear: item.publishYear,
      editionTag: item.editionTag,
      identifier: item.isbn,
      language: item.language,
      formats: item.format ? [item.format] : [],
      fileSize: item.fileSize,
      fileSizeText: item.filesizeString ?? (item.fileSize == null ? null : formatFileSize(item.fileSize)),
      coverUrl: item.coverUrl,
      description: item.description,
      sourceUrl: item.sourceUrl,
      downloadPath: item.downloadPath,
      downloadable: Boolean(item.hash),
      availability: item.hash ? "available" : "unavailable",
      hash: item.hash,
      md5: item.md5,
      sha256: item.sha256,
      zlibraryInterestScore: item.zlibraryInterestScore,
      zlibraryQualityScore: item.zlibraryQualityScore,
    };
  });
}

function dedupKey(item: RawSearchItem): string {
  const title = (item.title ?? "").toLowerCase().replace(/[\p{P}\p{S}]/gu, "").replace(/\s+/g, "");
  const authors = item.authors.map((author) => author.toLowerCase().trim()).sort().join(",");
  return `${title}|${authors}|${item.publishYear ?? ""}|${(item.editionTag ?? "").toLowerCase().trim()}|${item.format ?? ""}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}
