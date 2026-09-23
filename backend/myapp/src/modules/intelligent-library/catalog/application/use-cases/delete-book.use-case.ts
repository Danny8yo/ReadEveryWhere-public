import type { CatalogBookDeletionPort } from "../ports/catalog-book-deletion.port";

export class DeleteBookUseCase {
  constructor(
    private readonly deletion: CatalogBookDeletionPort,
  ) {}

  execute(userId: number, bookId: number): { deleted: boolean; bookId: number } {
    const now = new Date().toISOString();
    const deleted = this.deletion.deleteOne(userId, bookId, afterHours(24), now);
    return {
      deleted,
      bookId,
    };
  }

}

function afterHours(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}
