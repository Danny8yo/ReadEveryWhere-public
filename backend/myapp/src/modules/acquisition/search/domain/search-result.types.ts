import type { SourcePlatform } from "../../public";

export interface SearchResultItem {
  id: string;
  sourceBookId: string;
  sourcePlatform: SourcePlatform;
  title: string;
  authors: string[];
  publisher: string | null;
  publishYear: number | null;
  editionTag: string | null;
  identifier: string | null;
  language: string | null;
  formats: string[];
  fileSize: number | null;
  fileSizeText: string | null;
  coverUrl: string | null;
  description: string | null;
  sourceUrl: string | null;
  downloadPath: string | null;
  downloadable: boolean;
  availability: "available" | "unavailable";
  hash: string | null;
  md5: string | null;
  sha256: string | null;
  zlibraryInterestScore: number | null;
  zlibraryQualityScore: number | null;
}

export interface SearchPageResult {
  items: SearchResultItem[];
  total: number;
  page: number;
  pageSize: number;
  hasNext: boolean;
  nextPage: number | null;
  requestId: string;
  warnings: string[];
}
