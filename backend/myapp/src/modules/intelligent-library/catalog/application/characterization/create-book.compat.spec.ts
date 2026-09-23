import { CatalogError } from "../../domain/catalog.error";
import type { CreateBookCommand } from "../catalog.commands";
import type { BookDuplicateQueryPort } from "../ports/book-duplicate-query.port";
import type { BookRepositoryPort } from "../ports/book-repository.port";
import type { CatalogBookViewQueryPort } from "../ports/catalog-book-view-query.port";
import { CreateBookUseCase } from "../use-cases/create-book.use-case";

describe("CreateBookUseCase compatibility", () => {
  it("normalizes create input and preserves the complete returned view", () => {
    const dependencies = fakes();
    const useCase = new CreateBookUseCase(dependencies.books, dependencies.duplicates, dependencies.views);

    const result = useCase.execute(8, {
      title: "  Existing   Spaces ",
      authors: [" A ", "A", " B "],
      isbn: " 123 ",
    });

    expect(dependencies.duplicates.findPotentialDuplicate).toHaveBeenCalledWith(
      8,
      "existingspaces",
      "A, B",
      null,
      null,
    );
    expect(dependencies.books.insert).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 8,
      metadata: expect.objectContaining({ title: "Existing   Spaces", authors: ["A", "B"], isbn: "123" }),
    }));
    expect(result).toEqual(view());
  });

  it.each([
    [{ title: "Book", authors: [] }, "authors", "authors must contain at least one non-empty value"],
    [{ title: "Book", authors: ["A"], sourceBookId: "id" }, "sourcePlatform", "sourcePlatform is required when sourceBookId is provided"],
    [{ title: "Book", authors: ["A"], sourcePlatform: "zlibrary" }, "sourceBookId", "sourceBookId is required when sourcePlatform is not manual"],
  ] as const)("preserves validation for %j", (command, field, message) => {
    const dependencies = fakes();
    const useCase = new CreateBookUseCase(dependencies.books, dependencies.duplicates, dependencies.views);
    expect(() => useCase.execute(1, command as unknown as CreateBookCommand)).toThrow(expect.objectContaining({
      kind: "VALIDATION",
      field,
      message,
    } satisfies Partial<CatalogError>));
  });

  it("uses source identity instead of soft identity when sourceBookId exists", () => {
    const dependencies = fakes();
    dependencies.duplicates.findBySource = jest.fn().mockReturnValue(view({ id: 99 }));
    const useCase = new CreateBookUseCase(dependencies.books, dependencies.duplicates, dependencies.views);

    expect(() => useCase.execute(1, {
      title: "Book",
      authors: ["A"],
      sourcePlatform: "ZLIBRARY",
      sourceBookId: "source-1",
    })).toThrow(expect.objectContaining({
      kind: "CONFLICT",
      field: "sourceBookId",
      existingBookId: 99,
    } satisfies Partial<CatalogError>));
    expect(dependencies.duplicates.findPotentialDuplicate).not.toHaveBeenCalled();
  });

  it("maps the real SQLite source identity race to the existing resource conflict", () => {
    const dependencies = fakes();
    dependencies.duplicates.findBySource
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(view({ id: 99 }));
    dependencies.books.insert.mockImplementation(() => {
      throw new Error(
        "UNIQUE constraint failed: source_refs.user_id, source_refs.source_platform, source_refs.source_book_id",
      );
    });
    const useCase = new CreateBookUseCase(dependencies.books, dependencies.duplicates, dependencies.views);

    expect(() => useCase.execute(1, {
      title: "Book",
      authors: ["A"],
      sourcePlatform: "zlibrary",
      sourceBookId: "source-race",
    })).toThrow(expect.objectContaining({
      kind: "CONFLICT",
      field: "sourceBookId",
      existingBookId: 99,
    } satisfies Partial<CatalogError>));
  });
});

function fakes(): {
  books: jest.Mocked<BookRepositoryPort>;
  duplicates: jest.Mocked<BookDuplicateQueryPort>;
  views: jest.Mocked<CatalogBookViewQueryPort>;
} {
  return {
    books: {
      isOwnedBy: jest.fn(),
      findById: jest.fn(),
      insert: jest.fn().mockReturnValue(1),
      save: jest.fn(),
      delete: jest.fn(),
      findOwnedIds: jest.fn(),
      deleteMany: jest.fn(),
    },
    duplicates: {
      findBySource: jest.fn().mockReturnValue(null),
      findPotentialDuplicate: jest.fn().mockReturnValue(null),
      findByChecksum: jest.fn(),
    },
    views: {
      getBook: jest.fn().mockReturnValue(view()),
    },
  };
}

function view(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 8,
    title: "Existing   Spaces",
    authors: ["A", "B"],
    authorsText: "A, B",
    isbn: "123",
    coverUrl: null,
    description: null,
    publisher: null,
    sourcePlatform: "manual",
    sourceBookId: null,
    sourceUrl: null,
    publishYear: null,
    editionTag: null,
    version: 1,
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
    fileName: null,
    isDownloaded: false,
    fileUrl: null,
    checksum: null,
    mimeType: null,
    downloadStatus: null,
    downloadProgress: null,
    ...overrides,
  };
}
