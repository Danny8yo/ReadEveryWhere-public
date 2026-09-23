export type ProgressLocationType = "epubcfi" | "pdf_page";

export interface ReadingProgress {
  id: number;
  userId: number;
  bookId: number;
  bookHash: string;
  location: string;
  locationType: ProgressLocationType;
  fraction: number;
  deviceId: string;
  deviceSequence: number;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertProgressInput {
  userId: number;
  bookId: number;
  bookHash: string;
  location: string;
  locationType: ProgressLocationType;
  fraction: number;
  deviceId: string;
  deviceSequence: number;
}
