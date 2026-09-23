import type { CatalogBookDeletionPort } from "../ports/catalog-book-deletion.port";

export class BatchDeleteBooksUseCase {
  constructor(
    private readonly deletion: CatalogBookDeletionPort,
  ) {}

  execute(userId: number, ids: number[]): {
    requestedCount: number;
    deletedCount: number;
    deletedIds: number[];
    skippedIds: number[];
  } {
    const requestedIds = Array.from(new Set(ids));
    const now = new Date().toISOString();
    const deletedIds = this.deletion.deleteMany(userId, requestedIds, afterHours(24), now);
    const deletedSet = new Set<number>(deletedIds);
    const skippedIds = requestedIds.filter((id) => !deletedSet.has(id));

    return {
      requestedCount: requestedIds.length,
      deletedCount: deletedIds.length,
      deletedIds,
      skippedIds,
    };
  }
}

function afterHours(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}
