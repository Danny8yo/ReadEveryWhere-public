export type BookmarkLocationType = "epubcfi" | "pdf_page";

export interface Bookmark {
  id: number;
  userId: number;
  bookId: number;
  bookHash: string;
  location: string;
  locationType: BookmarkLocationType;
  fraction: number;
  chapterLabel: string | null;
  createdAt: number;
}

export interface CreateBookmarkInput {
  userId: number;
  bookId: number;
  bookHash: string;
  location: string;
  locationType: BookmarkLocationType;
  fraction: number;
  chapterLabel: string | null;
}
