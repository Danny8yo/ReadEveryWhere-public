export type LibraryVersion = Readonly<{ epoch: string; revision: number }>;
export const LIBRARY_PROJECTION_CHANGE_PORT = Symbol(
  "LIBRARY_PROJECTION_CHANGE_PORT",
);
export interface LibraryProjectionChangePort {
  changed(userId: number, taskId?: number): void;
  progress(input: {
    userId: number;
    bookId: number;
    taskId: number;
    progress: number;
  }): void;
}
