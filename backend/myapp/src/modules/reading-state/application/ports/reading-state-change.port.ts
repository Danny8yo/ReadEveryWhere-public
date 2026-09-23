export type ReadingStateChangeKind = "progress" | "bookmarks" | "annotations";

export interface ReadingStateMutationResult<T> {
  value: T;
  bookId: number | null;
  didChange: boolean;
}

export interface ReadingStateChangePort {
  transact<T>(input: Readonly<{
    userId: number;
    changed: readonly ReadingStateChangeKind[];
    sourceDeviceId?: string | null;
  }>, mutation: () => ReadingStateMutationResult<T>): T;
}

export const READING_STATE_CHANGE_PORT = Symbol("READING_STATE_CHANGE_PORT");
