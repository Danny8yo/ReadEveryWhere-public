import type { EbookFormat } from "../../intelligent-library/public/ebook-format";

export type SourcePlatform = "zlibrary";

export interface RawSearchItem {
  sourceBookId: string;
  title: string;
  authors: string[];
  coverUrl: string | null;
  publisher: string | null;
  publishYear: number | null;
  editionTag: string | null;
  format: string | null;
  language: string | null;
  fileSize: number | null;
  filesizeString: string | null;
  sourceUrl: string | null;
  downloadPath: string | null;
  hash: string | null;
  md5: string | null;
  sha256: string | null;
  description: string | null;
  isbn: string | null;
  zlibraryInterestScore: number | null;
  zlibraryQualityScore: number | null;
}

export interface RawSearchPage {
  items: RawSearchItem[];
  total: number;
}

export interface SearchSourcePort {
  readonly platform: SourcePlatform;
  searchBooks(
    keyword: string,
    page: number,
    pageSize: number,
    requestId: string,
    baseUrl: string,
    formats: readonly EbookFormat[],
  ): Promise<RawSearchPage>;
  isAvailable(): boolean;
}

export interface DownloadSourceOptions {
  userId: number;
  bookId: number;
  requestedFileName: string | null;
  sourceBookId: string;
  hash: string;
  onProgress?: (progress: number) => void;
}

export interface DownloadedArtifact {
  content: Buffer;
  localPath?: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  checksum: string;
}

export interface DownloadSourcePort {
  readonly platform: SourcePlatform;
  download(sourceUrl: string, options: DownloadSourceOptions): Promise<DownloadedArtifact>;
  recordCompleted?(userId: number): Promise<void>;
}

export interface SourceLoginResult {
  remix_userid: string;
  remix_userkey: string;
  downloads_today: number;
  downloads_limit: number;
  is_premium: boolean;
}

export interface SourceLoginPort {
  probe?(baseUrl: string): Promise<{ category: string; status: number | null; diagnostic: unknown }>;
  discoverDomains?(bootstrapUrl: string): Promise<{
    source: string;
    discoveredAt: string;
    candidates: Array<{ baseUrl: string; category: string; status: number | null; diagnostic: unknown }>;
  }>;
  loginWithCredentials(email: string, password: string, baseUrl: string): Promise<SourceLoginResult>;
  validateCookies(
    remixUserid: string,
    remixUserkey: string,
    baseUrl: string,
  ): Promise<SourceLoginResult>;
}
