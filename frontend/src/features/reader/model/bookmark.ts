export type BookmarkLocationType = "epubcfi" | "pdf_page";
export interface BookmarkRecord {
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
export interface CreateBookmarkParams {
    bookId: number;
    bookHash?: string;
    location: string;
    locationType?: BookmarkLocationType;
    fraction: number;
    chapterLabel?: string | null;
}
