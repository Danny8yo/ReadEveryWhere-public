import type { EbookFormat } from "../../domain/ebook-format";

export interface LibraryBookView {
  id: number;
  userId: number;
  title: string;
  authors: string[];
  authorsText: string;
  isbn: string | null;
  language?: string | null;
  coverUrl: string | null;
  description: string | null;
  publisher: string | null;
  sourcePlatform: string;
  sourceBookId: string | null;
  sourceUrl: string | null;
  publishYear: number | null;
  editionTag: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  fileName: string | null;
  fileSize: number | null;
  isDownloaded: boolean;
  fileUrl: string | null;
  checksum: string | null;
  mimeType: string | null;
  format: EbookFormat | null;
  downloadTaskId?: number | null;
  downloadStatus: string | null;
  downloadProgress: number | null;
  doubanRating: {
    sourcePlatform: "douban";
    sourceBookId: string;
    sourceUrl: string;
    title: string | null;
    rating: number | null;
    ratingCount: number | null;
    fetchedAt: string;
  } | null;
  readingProfile?: {
    id: string;
    primaryGenre: string | null;
    secondaryGenres: string[];
    traits: string[];
    confidence: { kind: "ai-score" | "user-determined" | null; score: number | null };
    classificationSummary: string | null;
    profileVersion: number;
    updatedAt: string;
  };
  bookAnalysis?: {
    status: "pending" | "running" | "ready" | "failed" | "stale" | "unsupported";
    primaryGenre: string | null;
    displayLabel: string | null;
    confidence: number | null;
    analyzedAt: string | null;
    stale: boolean;
    candidateId?: string | null;
  } | null;
}

export interface LibraryBookViewPage {
  items: LibraryBookView[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ListBooksInput {
  userId: number;
  page: number;
  pageSize: number;
  keyword?: string;
  primaryGenre?: string;
  secondaryGenre?: string;
  formats?: EbookFormat[];
}
