export interface ReadingStateVersionPort {
  getRevision(userId: number, bookId: number): number;
  bumpRevision(userId: number, bookId: number, now: number): number;
}

export const READING_STATE_VERSION_PORT = Symbol("READING_STATE_VERSION_PORT");
