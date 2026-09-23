export type ProgressLocationType = "epubcfi" | "pdf_page";
export interface ReadingProgressRecord {
    id: number;
    userId: number;
    bookId: number;
    bookHash: string;
    location: string;
    locationType: ProgressLocationType;
    fraction: number;
    deviceId: string | null;
    deviceSequence: number;
    revision: number;
    createdAt: number;
    updatedAt: number;
}
export interface UpsertProgressParams {
    bookId: number;
    bookHash?: string;
    location: string;
    locationType?: ProgressLocationType;
    fraction: number;
    deviceId?: string;
    deviceSequence: number;
}
