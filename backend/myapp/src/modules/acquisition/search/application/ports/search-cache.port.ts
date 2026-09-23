import type { SearchPageResult } from "../../domain/search-result.types";
import type { EbookFormat } from "../../../../intelligent-library/public/ebook-format";

export interface SearchCacheKey {
  keyword: string;
  sourcePlatform: string;
  page: number;
  pageSize: number;
  formats: EbookFormat[];
}

export interface SearchCachePort {
  find(key: Readonly<SearchCacheKey>, ttlMs: number): SearchPageResult | null;
  save(key: Readonly<SearchCacheKey>, result: Readonly<SearchPageResult>): void;
}

export const SEARCH_CACHE_PORT = Symbol("ACQUISITION_SEARCH_CACHE_PORT");
