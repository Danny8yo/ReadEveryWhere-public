import type { CatalogBookDeletionPort } from "../ports/catalog-book-deletion.port";
import { BatchDeleteBooksUseCase } from "../use-cases/batch-delete-books.use-case";
import { DeleteBookUseCase } from "../use-cases/delete-book.use-case";

describe("book deletion compatibility", () => {
  it("returns deleted=false for a missing or foreign book", () => {
    const deletion = fakeDeletion();
    deletion.deleteOne.mockReturnValue(false);
    const useCase = new DeleteBookUseCase(deletion);

    expect(useCase.execute(7, 99)).toEqual({ deleted: false, bookId: 99 });
    expect(deletion.deleteOne).toHaveBeenCalledWith(7, 99, expect.any(String), expect.any(String));
  });

  it("deletes the database book while leaving artifact cleanup to delayed GC", () => {
    const deletion = fakeDeletion();
    deletion.deleteOne.mockReturnValue(true);
    const useCase = new DeleteBookUseCase(deletion);

    expect(useCase.execute(7, 42)).toEqual({ deleted: true, bookId: 42 });
    expect(deletion.deleteOne).toHaveBeenCalledWith(7, 42, expect.any(String), expect.any(String));
  });

  it("deduplicates requested ids and preserves skipped request order", () => {
    const deletion = fakeDeletion();
    deletion.deleteMany.mockReturnValue([2, 3]);
    const useCase = new BatchDeleteBooksUseCase(deletion);

    expect(useCase.execute(7, [3, 3, 91, 2, 92])).toEqual({
      requestedCount: 4,
      deletedCount: 2,
      deletedIds: [2, 3],
      skippedIds: [91, 92],
    });
    expect(deletion.deleteMany).toHaveBeenCalledWith(
      7,
      [3, 91, 2, 92],
      expect.any(String),
      expect.any(String),
    );
  });
});

function fakeDeletion(): jest.Mocked<CatalogBookDeletionPort> {
  return {
    deleteOne: jest.fn(),
    deleteMany: jest.fn(),
  };
}
