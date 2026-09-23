import { ReadingProgress } from "../../domain/reading-progress.types";
import type { ReadingProgressRepositoryPort } from "../ports/reading-progress-repository.port";

export class GetProgressUseCase {
  constructor(private readonly repository: ReadingProgressRepositoryPort) {}

  execute(userId: number, bookId: number): ReadingProgress | null {
    return this.repository.findByUserBook(userId, bookId);
  }
}
