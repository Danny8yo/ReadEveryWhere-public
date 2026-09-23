import { CreateBookUseCase } from "../src/modules/intelligent-library/catalog/application/use-cases/create-book.use-case";
import type { Book } from "../src/modules/intelligent-library/catalog/domain/book";
import { normalizeBusinessError } from "./compat-loader";

const existingBook = book({ id: 91, title: "Existing" });

describe("CreateBookUseCase compatibility", () => {
  it("rejects a missing title with the stable field and message", () => {
    const { useCase, books } = createContext();

    const error = capture(() => useCase.execute(7, { authors: ["Author"] } as any));

    expect(error).toMatchObject({ field: "title", message: "title is required" });
    expect(books.insert).not.toHaveBeenCalled();
  });

  it("rejects authors that normalize to an empty list", () => {
    const { useCase, books } = createContext();

    const error = capture(() => useCase.execute(7, { title: "Book", authors: [" ", "\t"] }));

    expect(error).toMatchObject({
      field: "authors",
      message: "authors must contain at least one non-empty value",
    });
    expect(books.insert).not.toHaveBeenCalled();
  });

  it("rejects sourceBookId when the original sourcePlatform is absent", () => {
    const { useCase, books, duplicates } = createContext();

    const error = capture(() => useCase.execute(7, {
      title: "Source-only book",
      authors: ["Author"],
      sourceBookId: " source-7 ",
    }));

    expect(error).toMatchObject({
      field: "sourcePlatform",
      message: "sourcePlatform is required when sourceBookId is provided",
    });
    expect(duplicates.findBySource).not.toHaveBeenCalled();
    expect(books.insert).not.toHaveBeenCalled();
  });

  it("requires sourceBookId for a non-manual sourcePlatform", () => {
    const { useCase, books } = createContext();

    const error = capture(() => useCase.execute(7, {
      title: "Remote book",
      authors: ["Author"],
      sourcePlatform: " zlibrary ",
    }));

    expect(error).toMatchObject({
      field: "sourceBookId",
      message: "sourceBookId is required when sourcePlatform is not manual",
    });
    expect(books.insert).not.toHaveBeenCalled();
  });

  it("normalizes sourcePlatform case and surrounding whitespace before lookup and persistence", () => {
    const { useCase, books, duplicates } = createContext();

    useCase.execute(7, {
      title: " Remote Book ",
      authors: [" First Author ", "First Author", "Second Author"],
      sourcePlatform: " ZLibrary ",
      sourceBookId: " source-42 ",
    });

    expect(duplicates.findBySource).toHaveBeenCalledWith(7, "zlibrary", "source-42");
    expect(books.insert).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 7,
      metadata: expect.objectContaining({
        title: "Remote Book",
        authors: ["First Author", "Second Author"],
      }),
      sourceReferences: [expect.objectContaining({
        platform: "zlibrary",
        sourceBookId: "source-42",
      })],
    }));
  });

  it("rejects an existing sourcePlatform and sourceBookId pair", () => {
    const { useCase, books, duplicates } = createContext();
    duplicates.findBySource.mockReturnValue(existingBook);

    const error = capture(() => useCase.execute(7, {
      title: "Duplicate remote book",
      authors: ["Author"],
      sourcePlatform: "zlibrary",
      sourceBookId: "source-91",
    }));

    expect(error).toMatchObject({
      field: "sourceBookId",
      existingBookId: 91,
      message: "Book already exists with the same sourcePlatform + sourceBookId",
    });
    expect(books.insert).not.toHaveBeenCalled();
  });

  it("rejects a potential duplicate manual book", () => {
    const { useCase, duplicates } = createContext();
    duplicates.findPotentialDuplicate.mockReturnValue(existingBook);

    const error = capture(() => useCase.execute(7, {
      title: " Existing! ",
      authors: ["Author"],
      publishYear: 2026,
      editionTag: " First ",
    }));

    expect(duplicates.findPotentialDuplicate).toHaveBeenCalledWith(
      7,
      "existing",
      "Author",
      2026,
      "First",
    );
    expect(error).toMatchObject({
      field: "title",
      existingBookId: 91,
      message: "Book already exists with the same normalized identity",
    });
  });

  it("maps a source_refs unique constraint race to the stable conflict", () => {
    const { useCase, books, duplicates } = createContext();
    duplicates.findBySource
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(existingBook);
    books.insert.mockImplementation(() => {
      throw new Error(
        "UNIQUE constraint failed: source_refs.user_id, source_refs.source_platform, source_refs.source_book_id",
      );
    });
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const error = capture(() => useCase.execute(7, {
      title: "Raced book",
      authors: ["Author"],
      sourcePlatform: "zlibrary",
      sourceBookId: "source-91",
    }));

    expect(error).toMatchObject({
      field: "sourceBookId",
      existingBookId: 91,
      message: "Book already exists with the same sourcePlatform + sourceBookId",
    });
    consoleError.mockRestore();
  });

  it("passes the complete normalized input to repository persistence", () => {
    const { useCase, books } = createContext();

    const result = useCase.execute(7, {
      title: " Persisted Book ",
      authors: ["Author A", "Author B"],
      sourcePlatform: " ZLIBRARY ",
      sourceBookId: " source-77 ",
      sourceUrl: " https://example.test/books/77 ",
      hash: " hash-77 ",
      format: "epub",
      isbn: " 9780000000000 ",
      publisher: " Publisher ",
      publishYear: 2026,
      editionTag: " First ",
    });

    expect(books.insert).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 7,
      metadata: expect.objectContaining({
        title: "Persisted Book",
        authors: ["Author A", "Author B"],
        isbn: "9780000000000",
        coverUrl: null,
        description: null,
        publisher: "Publisher",
        publishYear: 2026,
        editionTag: "First",
      }),
      sourceReferences: [expect.objectContaining({
        platform: "zlibrary",
        sourceBookId: "source-77",
        sourceUrl: "https://example.test/books/77",
        hash: "hash-77",
        format: "epub",
      })],
    }));
    expect(result).toMatchObject({ userId: 7, sourcePlatform: "zlibrary", sourceBookId: "source-77" });
  });
});

function createContext() {
  let inserted: Book | null = null;
  const books = {
    isOwnedBy: jest.fn().mockReturnValue(false),
    findById: jest.fn().mockReturnValue(null),
    insert: jest.fn((bookToInsert: Book) => {
      inserted = bookToInsert;
      return 1;
    }),
    save: jest.fn(),
    delete: jest.fn().mockReturnValue(false),
    findOwnedIds: jest.fn().mockReturnValue([]),
    deleteMany: jest.fn(),
  };
  const duplicates = {
    findBySource: jest.fn().mockReturnValue(null),
    findPotentialDuplicate: jest.fn().mockReturnValue(null),
    findByChecksum: jest.fn().mockReturnValue(null),
  };
  const views = {
    listBooks: jest.fn(),
    getBook: jest.fn((userId: number, id: number) => inserted ? viewFromBook(inserted, id, userId) : null),
  };

  return { books, duplicates, views, useCase: new CreateBookUseCase(books, duplicates, views) };
}

function viewFromBook(created: Book, id: number, userId: number) {
  const metadata = created.metadata;
  const source = created.sourceReferences[0];
  return book({
    id,
    userId,
    title: metadata.title,
    authors: metadata.authors,
    authorsText: metadata.authors.join(", "),
    isbn: metadata.isbn,
    coverUrl: metadata.coverUrl,
    description: metadata.description,
    publisher: metadata.publisher,
    sourcePlatform: source?.platform ?? "manual",
    sourceBookId: source?.sourceBookId ?? null,
    sourceUrl: source?.sourceUrl ?? null,
    publishYear: metadata.publishYear,
    editionTag: metadata.editionTag,
  });
}

function capture(action: () => unknown) {
  try {
    action();
  } catch (error) {
    return normalizeBusinessError(error);
  }
  throw new Error("Expected action to throw");
}

function book(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 7,
    title: "Book",
    authors: ["Author"],
    authorsText: "Author",
    isbn: null,
    coverUrl: null,
    description: null,
    publisher: null,
    sourcePlatform: "manual",
    sourceBookId: null,
    sourceUrl: null,
    publishYear: null,
    editionTag: null,
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    fileName: null,
    fileSize: null,
    isDownloaded: false,
    fileUrl: null,
    checksum: null,
    mimeType: null,
    format: null,
    downloadStatus: null,
    downloadProgress: null,
    doubanRating: null,
    ...overrides,
  };
}
