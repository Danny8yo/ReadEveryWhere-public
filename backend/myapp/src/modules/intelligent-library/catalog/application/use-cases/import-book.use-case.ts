import { createHash } from "node:crypto";
import { Book } from "../../domain/book";
import { CatalogError } from "../../domain/catalog.error";
import { normalizeAuthors, normalizeOptionalString } from "../../domain/library.utils";
import type { ImportBookCommand } from "../catalog.commands";
import type { ImportBookResult, ImportScrapeQueryStrategy } from "../catalog.types";
import type { BookDuplicateQueryPort } from "../ports/book-duplicate-query.port";
import type { BookRepositoryPort } from "../ports/book-repository.port";
import type { CatalogBookViewQueryPort } from "../ports/catalog-book-view-query.port";
import type { ImportedBookInspectorPort } from "../ports/imported-book-inspector.port";
import type { ImportedFileStorePort } from "../ports/imported-file-store.port";
import { AttachBookFileUseCase } from "./attach-book-file.use-case";

export class ImportBookUseCase {
  constructor(
    private readonly books: BookRepositoryPort,
    private readonly duplicates: BookDuplicateQueryPort,
    private readonly views: CatalogBookViewQueryPort,
    private readonly files: ImportedFileStorePort,
    private readonly inspector: ImportedBookInspectorPort,
    private readonly attachFile: AttachBookFileUseCase,
  ) {}

  async execute(input: ImportBookCommand): Promise<ImportBookResult> {
    const sanitizedName = input.file.originalname.replace(/[\\/:*?"<>|]/g, "_").trim()
      || `import_${Date.now()}`;
    const { fileName, writePath } = this.resolveTarget(
      input.userId,
      sanitizedName,
      input.conflictPolicy,
    );
    const mimeType = this.inspector.detectMimeType(input.file.buffer, sanitizedName);
    if (!mimeType) {
      throw CatalogError.validation("file", "Invalid EPUB, PDF, MOBI, or AZW3 file format");
    }

    // Checksum remains a stable pure calculation before physical file delivery.
    const checksum = createHash("sha256").update(input.file.buffer).digest("hex");
    const existing = this.duplicates.findByChecksum(input.userId, checksum);
    if (existing) {
      throw CatalogError.conflict("file", `File already imported as ${existing.title}`, existing.id);
    }

    try {
      this.files.write(writePath, input.file.buffer);
    } catch (error) {
      this.files.remove(writePath);
      throw error;
    }
    let embedded;
    try {
      embedded = this.inspector.parseMetadata(input.file.buffer);
    } catch (error) {
      this.files.remove(writePath);
      throw error;
    }

    const title = input.title || embedded?.title || this.titleFromFileName(sanitizedName);
    const authors = input.authors
      ? input.authors.split(/[,，;；]/g).map((author) => author.trim()).filter(Boolean)
      : embedded?.authors ?? [];
    const book = Book.createImported({
      ownerId: input.userId,
      authorsText: authors.join(", "),
      metadata: {
        title,
        authors,
        isbn: normalizeOptionalString(input.isbn) || normalizeOptionalString(embedded?.isbn),
        language: embedded?.language,
        coverUrl: normalizeOptionalString(input.coverUrl),
        description: embedded?.description,
        publisher: embedded?.publisher,
        publishYear: embedded?.publishYear,
        editionTag: null,
      },
    });

    let bookId: number;
    try {
      bookId = this.books.insert(book);
    } catch (error) {
      this.files.remove(writePath);
      throw error;
    }

    try {
      await this.attachFile.execute({
        userId: input.userId,
        bookId,
        sourcePlatform: null,
        sourceUrl: null,
        localPath: writePath,
        fileName,
        mimeType,
        fileSize: input.file.size,
        checksum,
      });
    } catch (error) {
      this.books.delete(input.userId, bookId);
      this.files.remove(writePath);
      if (this.isChecksumConflict(error)) {
        const duplicate = this.duplicates.findByChecksum(input.userId, checksum);
        throw duplicate
          ? CatalogError.conflict("file", `File already imported as ${duplicate.title}`, duplicate.id)
          : CatalogError.conflict("file", "File already imported");
      }
      throw error;
    }

    const persisted = this.views.getBook(input.userId, bookId);
    if (!persisted) throw CatalogError.internal();
    const { scrapeQuery, scrapeQueryStrategy } = this.buildScrapeQuery(persisted, sanitizedName);
    return {
      importStatus: "imported",
      metadataStatus: scrapeQuery ? "pending" : "none",
      scrapeQuery,
      scrapeQueryStrategy,
      originalFileName: input.file.originalname,
      storedFileName: fileName,
      book: persisted,
    };
  }

  private resolveTarget(ownerId: number, sanitizedName: string, policy: ImportBookCommand["conflictPolicy"]) {
    let fileName = sanitizedName;
    let absolutePath = this.files.pathForImport(ownerId, fileName);
    if (!this.files.exists(absolutePath)) return { fileName, writePath: absolutePath };
    if (policy === "skip") {
      throw CatalogError.validation("file", `File ${fileName} already exists and conflictPolicy is skip`);
    }
    if (policy === "rename") {
      let counter = 1;
      const dot = sanitizedName.lastIndexOf(".");
      const base = dot >= 0 ? sanitizedName.slice(0, dot) : sanitizedName;
      const extension = dot >= 0 ? sanitizedName.slice(dot) : "";
      do {
        fileName = `${base} (${counter})${extension}`;
        absolutePath = this.files.pathForImport(ownerId, fileName);
        counter += 1;
      } while (this.files.exists(absolutePath));
    }
    const writePath = policy === "overwrite"
      ? this.files.stagingPathForImport(ownerId, fileName)
      : absolutePath;
    return { fileName, writePath };
  }

  private titleFromFileName(fileName: string): string {
    const dot = fileName.lastIndexOf(".");
    const base = dot >= 0 ? fileName.slice(0, dot) : fileName;
    return base.replace(/[_\-]+/g, " ").trim() || `未命名书籍 ${Date.now()}`;
  }

  private buildScrapeQuery(
    book: { title: string; authors: string[]; isbn: string | null },
    fileName: string,
  ): { scrapeQuery: string; scrapeQueryStrategy: ImportScrapeQueryStrategy } {
    const isbn = normalizeOptionalString(book.isbn);
    if (isbn) return { scrapeQuery: isbn, scrapeQueryStrategy: "isbn" };
    const title = normalizeOptionalString(book.title);
    const authors = normalizeAuthors(book.authors);
    if (title && authors.length > 0) {
      return { scrapeQuery: `${title} ${authors.join(" ")}`, scrapeQueryStrategy: "title_author" };
    }
    if (title) return { scrapeQuery: title, scrapeQueryStrategy: "title" };
    return { scrapeQuery: this.titleFromFileName(fileName), scrapeQueryStrategy: "filename" };
  }

  private isChecksumConflict(error: unknown): boolean {
    const value = error as { code?: unknown; message?: unknown };
    const code = typeof value.code === "string" ? value.code : "";
    const message = typeof value.message === "string" ? value.message : "";
    return code.startsWith("SQLITE_CONSTRAINT")
      && (
        message.includes("uq_book_artifacts_active_checksum")
        || message.includes("book_artifacts.user_id, book_artifacts.checksum")
      );
  }

}
