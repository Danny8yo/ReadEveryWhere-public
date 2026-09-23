import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";
import { AttachBookFileUseCase } from "../src/modules/intelligent-library/catalog/application/use-cases/attach-book-file.use-case";
import { ImportBookUseCase } from "../src/modules/intelligent-library/catalog/application/use-cases/import-book.use-case";
import type { Book } from "../src/modules/intelligent-library/catalog/domain/book";
import { BookArtifact } from "../src/modules/intelligent-library/catalog/domain/book-artifact";
import { CatalogError } from "../src/modules/intelligent-library/catalog/domain/catalog.error";
import { toCatalogHttpError } from "../src/modules/intelligent-library/library-queries/presentation/http/catalog-error.mapper";
import { normalizeBusinessError } from "./compat-loader";
import type { PdfPageTreeOptimizerPort } from "../src/modules/intelligent-library/catalog/application/ports/pdf-page-tree-optimizer.port";

// AttachBookFileUseCase 现在会在 PDF 落库前调用页树重建。这些用例不关心重建本身，
// 桩件只把磁盘上文件的真实大小报回去，保持落库事实自洽。
const stubPdfPageTrees: PdfPageTreeOptimizerPort = {
  optimize: async (absolutePath: string) => ({
    optimized: false,
    fileSize: readFileSync(absolutePath).byteLength,
    skipReason: "stubbed in tests",
  }),
};


describe("local book import failure compensation compatibility", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("removes the stored file when Book insert fails", async () => {
    const context = createContext();
    context.booksPort.insert.mockImplementation(() => {
      throw new Error("injected create failure");
    });

    await expect(invokeImport(context.importer, importInput("create-failure.pdf")))
      .rejects.toThrow("injected create failure");

    expect(context.books).toHaveLength(0);
    expect(context.bookFiles).toHaveLength(0);
    expect(storedFiles(context.root)).toEqual([]);
  });

  it("removes the stored file when EPUB metadata parsing fails", async () => {
    const context = createContext();
    context.inspector.parseMetadata.mockImplementation(() => {
      throw new Error("injected parser failure");
    });

    await expect(invokeImport(context.importer, importInput("parser-failure.pdf")))
      .rejects.toThrow("injected parser failure");

    expect(context.books).toHaveLength(0);
    expect(context.bookFiles).toHaveLength(0);
    expect(storedFiles(context.root)).toEqual([]);
  });

  it("removes the created book and stored file when artifact activation fails", async () => {
    const context = createContext({ insertError: new Error("injected artifact activation failure") });

    await expect(invokeImport(context.importer, importInput("book-file-failure.pdf")))
      .rejects.toThrow("injected artifact activation failure");

    expect(context.booksPort.delete).toHaveBeenCalledWith(7, 1);
    expect(context.books).toHaveLength(0);
    expect(context.bookFiles).toHaveLength(0);
    expect(storedFiles(context.root)).toEqual([]);
  });

  it.each([
    "UNIQUE constraint failed: book_artifacts.user_id, book_artifacts.checksum",
    "UNIQUE constraint failed: uq_book_artifacts_active_checksum",
  ])("maps a checksum unique race and leaves no orphaned state: %s", async (message) => {
    const constraint = Object.assign(
      new Error(message),
      { code: "SQLITE_CONSTRAINT_UNIQUE" },
    );
    const context = createContext({ insertError: constraint });
    context.duplicates.findByChecksum
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(book({ id: 88, title: "Existing checksum book" }));

    const error = await capture(() => invokeImport(context.importer, importInput("checksum-race.pdf")));

    expect(error).toMatchObject({
      status: 409,
      code: 40003,
      field: "file",
      reason: "RESOURCE_CONFLICT",
      existingBookId: 88,
      message: "File already imported as Existing checksum book",
    });
    expect(context.books).toHaveLength(0);
    expect(context.bookFiles).toHaveLength(0);
    expect(storedFiles(context.root)).toEqual([]);
  });

  it("isolates one failed batch item from the next item and cleans the failed item", async () => {
    const context = createContext();
    context.inspector.parseMetadata
      .mockImplementationOnce(() => {
        throw new Error("first item parser failure");
      })
      .mockReturnValue({});

    const outcomes: Array<{ status: string; value?: unknown; error?: unknown }> = [];
    for (const fileName of ["first-fails.pdf", "second-succeeds.pdf"]) {
      try {
        outcomes.push({ status: "imported", value: await invokeImport(context.importer, importInput(fileName)) });
      } catch (error) {
        outcomes.push({ status: "failed", error });
      }
    }

    expect(outcomes.map((item) => item.status)).toEqual(["failed", "imported"]);
    expect(context.books).toHaveLength(1);
    expect(context.bookFiles).toHaveLength(1);
    expect(storedFiles(context.root)).toEqual([]);
    expect(artifactFiles(context.root)).toHaveLength(1);
  });

  it("keeps the existing file and creates no records when conflictPolicy is skip", async () => {
    const context = createContext();
    const existingPath = seedStoredFile(context.root, "conflict.pdf", Buffer.from("original"));

    const error = await capture(() => invokeImport(context.importer, {
      ...importInput("conflict.pdf"),
      conflictPolicy: "skip",
    }));

    expect(error).toMatchObject({
      field: "file",
      message: "File conflict.pdf already exists and conflictPolicy is skip",
    });
    expect(context.books).toHaveLength(0);
    expect(context.bookFiles).toHaveLength(0);
    expect(readFileSync(existingPath, "utf8")).toBe("original");
    expect(storedFiles(context.root)).toEqual(["conflict.pdf"]);
  });

  it("keeps the existing file and imports to a numbered name when conflictPolicy is rename", async () => {
    const context = createContext();
    const existingPath = seedStoredFile(context.root, "conflict.pdf", Buffer.from("original"));

    await invokeImport(context.importer, importInput("conflict.pdf"));

    expect(context.books).toHaveLength(1);
    expect(context.bookFiles).toEqual([
      expect.objectContaining({
        localPath: expect.stringMatching(/^7\/artifacts\/[^/]+\.pdf$/),
        sourcePlatform: null,
        sourceUrl: null,
      }),
    ]);
    expect(readFileSync(existingPath, "utf8")).toBe("original");
    expect(storedFiles(context.root)).toEqual(["conflict.pdf"]);
    expect(artifactFiles(context.root)).toHaveLength(1);
  });

  it.each([
    {
      name: "title surrounding whitespace",
      title: "  Name  ",
      authors: undefined,
      expectedTitle: "  Name  ",
      expectedAuthors: [],
      expectedAuthorsText: "",
    },
    {
      name: "whitespace-only title",
      title: "   ",
      authors: undefined,
      expectedTitle: "   ",
      expectedAuthors: [],
      expectedAuthorsText: "",
    },
    {
      name: "duplicate authors and internal whitespace",
      title: "Book",
      authors: " A  B , A  B, C ",
      expectedTitle: "Book",
      expectedAuthors: ["A B", "C"],
      expectedAuthorsText: "A  B, A  B, C",
    },
  ])("保留本地导入字段字节：$name", async ({
    title,
    authors,
    expectedTitle,
    expectedAuthors,
    expectedAuthorsText,
  }) => {
    const context = createContext();

    const result = await invokeImport(context.importer, {
      ...importInput("field-compat.pdf"),
      title,
      authors,
    });

    expect(result.book).toMatchObject({
      title: expectedTitle,
      authors: expectedAuthors,
      authorsText: expectedAuthorsText,
    });
  });

  function createContext(options: { insertError?: Error } = {}) {
    const root = mkdtempSync(resolve(tmpdir(), "read-everywhere-import-compat-"));
    roots.push(root);
    const books: Array<{ id: number; aggregate: Book }> = [];
    const bookFiles: any[] = [];
    let nextBookId = 1;

    const booksPort = {
      isOwnedBy: jest.fn((userId: number, bookId: number) => (
        books.some((item) => item.id === bookId && item.aggregate.ownerId === userId)
      )),
      findById: jest.fn().mockReturnValue(null),
      insert: jest.fn((aggregate: Book) => {
        const id = nextBookId++;
        books.push({ id, aggregate });
        return id;
      }),
      save: jest.fn(),
      delete: jest.fn((userId: number, bookId: number) => {
        const index = books.findIndex((item) => item.aggregate.ownerId === userId && item.id === bookId);
        if (index < 0) return false;
        books.splice(index, 1);
        for (let fileIndex = bookFiles.length - 1; fileIndex >= 0; fileIndex -= 1) {
          if (bookFiles[fileIndex].bookId === bookId) bookFiles.splice(fileIndex, 1);
        }
        return true;
      }),
      findOwnedIds: jest.fn().mockReturnValue([]),
      deleteMany: jest.fn(),
    };
    const duplicates = {
      findByChecksum: jest.fn().mockReturnValue(null),
      findBySource: jest.fn().mockReturnValue(null),
      findPotentialDuplicate: jest.fn().mockReturnValue(null),
    };
    const artifactRecords = new Map<string, BookArtifact>();
    const bookFilesPort = {
      reserve: jest.fn((artifact: BookArtifact) => artifactRecords.set(artifact.snapshot.artifactId, artifact)),
      activate: jest.fn((artifact: BookArtifact) => {
        if (options.insertError) throw options.insertError;
        artifactRecords.set(artifact.snapshot.artifactId, artifact);
        const snapshot = artifact.snapshot;
        bookFiles.push({
          userId: snapshot.ownerId,
          bookId: snapshot.bookId,
          localPath: snapshot.storedPath,
          sourcePlatform: snapshot.sourcePlatform,
          sourceUrl: snapshot.sourceUrl,
        });
      }),
      findById: jest.fn().mockReturnValue(null),
      findByDeliveryId: jest.fn().mockReturnValue(null),
      findCurrent: jest.fn().mockReturnValue(null),
      abort: jest.fn(),
      retireCurrentExact: jest.fn().mockReturnValue(false),
      claimCollectable: jest.fn().mockReturnValue([]),
      markDeleted: jest.fn().mockReturnValue(false),
      recordCleanupFailure: jest.fn(),
      recoverExpiredReservations: jest.fn().mockReturnValue(0),
    };
    const files = {
      pathForImport: (userId: number, fileName: string) => {
        const directory = resolve(root, String(userId), "imports");
        mkdirSync(directory, { recursive: true });
        return resolve(directory, fileName);
      },
      stagingPathForImport: (userId: number, fileName: string) => {
        const directory = resolve(root, String(userId), "imports", ".staging");
        mkdirSync(directory, { recursive: true });
        return resolve(directory, `staging-${fileName}`);
      },
      exists: (absolutePath: string) => existsSync(absolutePath),
      write: (absolutePath: string, content: Buffer) => writeFileSync(absolutePath, content),
      remove: (absolutePath: string) => {
        try { unlinkSync(absolutePath); } catch { /* Compatibility cleanup ignores failures. */ }
      },
    };
    const inspector = {
      detectMimeType: jest.fn().mockReturnValue("application/pdf"),
      parseMetadata: jest.fn().mockReturnValue({}),
    };
    const artifacts = {
      allocate: (ownerId: number, artifactId: string, fileName: string) => {
        const extension = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")) : "";
        const directory = resolve(root, String(ownerId), "artifacts");
        const stagingDirectory = resolve(directory, ".staging");
        mkdirSync(stagingDirectory, { recursive: true });
        const absolutePath = resolve(directory, `${artifactId}${extension}`);
        const stagingAbsolutePath = resolve(stagingDirectory, `${artifactId}.part`);
        return {
          storedPath: relative(root, absolutePath),
          stagingStoredPath: relative(root, stagingAbsolutePath),
          absolutePath,
          stagingAbsolutePath,
        };
      },
      stage: (content: Buffer, paths: any) => {
        writeFileSync(paths.stagingAbsolutePath, content);
        renameSync(paths.stagingAbsolutePath, paths.absolutePath);
      },
      adopt: (sourceAbsolutePath: string, paths: any) => {
        renameSync(sourceAbsolutePath, paths.stagingAbsolutePath);
        renameSync(paths.stagingAbsolutePath, paths.absolutePath);
      },
      toStoredPath: (absolutePath: string) => relative(root, absolutePath),
      resolveStoredPath: (storedPath: string) => resolve(root, storedPath),
      remove: jest.fn(),
    };
    const views = {
      listBooks: jest.fn(),
      getBook: jest.fn((userId: number, bookId: number) => {
        const stored = books.find((item) => item.id === bookId && item.aggregate.ownerId === userId);
        return stored ? viewFromBook(stored.aggregate, bookId) : null;
      }),
    };
    const attach = new AttachBookFileUseCase(booksPort, bookFilesPort, artifacts, stubPdfPageTrees);
    const importer = new ImportBookUseCase(booksPort, duplicates, views, files, inspector, attach);

    return { root, books, bookFiles, booksPort, duplicates, inspector, importer };
  }
});

function invokeImport(importer: ImportBookUseCase, input: any) {
  return importer.execute(input);
}

function importInput(originalname: string) {
  const buffer = Buffer.from("%PDF-1.4\ncompatibility fixture\n%%EOF");
  return {
    userId: 7,
    file: { originalname, mimetype: "application/pdf", buffer, size: buffer.length },
    conflictPolicy: "rename",
  };
}

function storedFiles(root: string): string[] {
  const importsDir = resolve(root, "7", "imports");
  try {
    return readdirSync(importsDir).sort();
  } catch {
    return [];
  }
}

function artifactFiles(root: string): string[] {
  const artifactsDir = resolve(root, "7", "artifacts");
  try {
    return readdirSync(artifactsDir).filter((name) => name !== ".staging").sort();
  } catch {
    return [];
  }
}

function seedStoredFile(root: string, fileName: string, content: Buffer): string {
  const importsDir = resolve(root, "7", "imports");
  mkdirSync(importsDir, { recursive: true });
  const path = resolve(importsDir, fileName);
  writeFileSync(path, content);
  return path;
}

async function capture(action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    return normalizeBusinessError(error instanceof CatalogError ? toCatalogHttpError(error) : error);
  }
  throw new Error("Expected action to throw");
}

function book(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 7,
    title: "Imported Book",
    authors: [],
    authorsText: "",
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

function viewFromBook(aggregate: Book, id: number) {
  const metadata = aggregate.metadata;
  return book({
    id,
    userId: aggregate.ownerId,
    title: metadata.title,
    authors: metadata.authors,
    authorsText: aggregate.authorsTextForPersistence,
    isbn: metadata.isbn,
    coverUrl: metadata.coverUrl,
    description: metadata.description,
    publisher: metadata.publisher,
    publishYear: metadata.publishYear,
    editionTag: metadata.editionTag,
  });
}
