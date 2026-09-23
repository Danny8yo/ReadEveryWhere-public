export interface OwnedBookAnalysisSource {
  bookId: number;
  userId: number;
  fileName: string | null;
  mimeType: string | null;
  downloadStatus: string | null;
}

export interface BookAnalysisLibraryPort {
  findOwnedAnalysisSource(userId: number, bookId: number): OwnedBookAnalysisSource | null;
  requireOwned(userId: number, bookId: number): unknown;
}
