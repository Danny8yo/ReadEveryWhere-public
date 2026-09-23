import type { LibraryBookView } from "./query-model/library-book.view";

export type ImportMetadataStatus =
  | "none"
  | "pending"
  | "scraping"
  | "candidates_found"
  | "applied"
  | "skipped"
  | "failed";

export type ImportScrapeQueryStrategy = "isbn" | "title_author" | "title" | "filename";

export interface ImportBookResult {
  importStatus: "imported";
  metadataStatus: ImportMetadataStatus;
  scrapeQuery: string;
  scrapeQueryStrategy: ImportScrapeQueryStrategy;
  originalFileName: string;
  storedFileName: string | null;
  book: LibraryBookView;
}

export interface BatchImportBookResultItem {
  index: number;
  originalFileName: string;
  importStatus: "imported" | "failed";
  metadataStatus: ImportMetadataStatus;
  scrapeQuery?: string;
  scrapeQueryStrategy?: ImportScrapeQueryStrategy;
  storedFileName?: string | null;
  book?: LibraryBookView;
  error?: string;
}

export interface BatchImportBookResult {
  items: BatchImportBookResultItem[];
  importedCount: number;
  failedCount: number;
}
