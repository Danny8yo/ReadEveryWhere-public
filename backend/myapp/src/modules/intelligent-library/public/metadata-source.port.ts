export interface ScrapedBook {
  sourcePlatform: string;
  sourceBookId: string;
  sourceUrl: string | null;
  title: string;
  authors: string[];
  isbn: string | null;
  publisher: string | null;
  publishYear: number | null;
  description: string | null;
  coverUrl: string | null;
  language: string | null;
  editionTag: string | null;
}

export interface MetadataSourcePort {
  readonly platform: string;
  search(input: MetadataSourceRequest): Promise<ScrapedBook[]>;
}

export interface MetadataSourceRequest {
  userId: number;
  requestId: string;
  keyword?: string;
  baseUrl?: string;
  cookie?: string;
  bookId?: number;
}

export interface MetadataSourceContextPort {
  resolveZlibraryBaseUrl(userId?: number): string;
}

export const METADATA_SOURCE_CONTEXT_PORT = Symbol(
  "INTELLIGENT_LIBRARY_METADATA_SOURCE_CONTEXT_PORT",
);

export const METADATA_SOURCE_PORTS = Symbol(
  "INTELLIGENT_LIBRARY_METADATA_SOURCE_PORTS",
);

export const AI_METADATA_SOURCE_PORT = Symbol(
  "INTELLIGENT_LIBRARY_AI_METADATA_SOURCE_PORT",
);

export interface DoubanRatingCandidate {
  sourcePlatform: "douban";
  sourceBookId: string;
  sourceUrl: string;
  title: string | null;
  authors: string[];
  publisher: string | null;
  publishYear: number | null;
  isbn: string | null;
  rating: number | null;
  ratingCount: number | null;
}

export interface DoubanRatingSourcePort {
  searchRatingCandidates(
    keyword: string,
    requestId: string,
    cookie?: string,
  ): Promise<DoubanRatingCandidate[]>;
}

export const DOUBAN_RATING_SOURCE_PORT = Symbol(
  "INTELLIGENT_LIBRARY_DOUBAN_RATING_SOURCE_PORT",
);
