import type {
  ReadingProgress,
  UpsertProgressInput,
} from "../../domain/reading-progress.types";

export interface ReadingProgressRepositoryPort {
  upsert(input: UpsertProgressInput & { now: number }): {
    progress: ReadingProgress;
    changed: boolean;
  };
  findByUserBook(userId: number, bookId: number): ReadingProgress | null;
}

export const READING_PROGRESS_REPOSITORY_PORT = Symbol(
  "READING_STATE_READING_PROGRESS_REPOSITORY_PORT",
);
