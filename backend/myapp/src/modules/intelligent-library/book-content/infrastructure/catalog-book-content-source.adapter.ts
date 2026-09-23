import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { BookContentCatalogPort } from "../../catalog/application/ports/book-content-catalog.port";
import type { BookContentSourcePort } from "../application/ports/book-content-source.port";
import { ReaderToolException } from "../domain/reader-tool-error";

@Injectable()
export class CatalogBookContentSourceAdapter implements BookContentSourcePort {
  constructor(private readonly catalog: BookContentCatalogPort) {}

  findOwnedBook(userId: number, bookId: number) {
    const book = this.catalog.findById(userId, bookId);
    return book ? { id: book.id, title: book.title, authors: book.authors } : null;
  }

  async readOwnedEpubArtifact(userId: number, bookId: number) {
    const file = this.requireFile(userId, bookId);
    if (!file.checksum || !file.artifactId) throw new ReaderToolException("CONTENT_REVISION_MISMATCH", "Missing artifact identity");
    const buffer = await this.readFile(file.filePath);
    const fileChecksum = `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
    if (fileChecksum !== `sha256:${file.checksum.replace(/^sha256:/, "")}`)
      throw new ReaderToolException("CONTENT_REVISION_MISMATCH", "Stored EPUB bytes do not match the current artifact checksum");
    return { buffer, artifact: { bookId, artifactId: file.artifactId, fileChecksum } };
  }
  async readOwnedEpub(userId: number, bookId: number): Promise<Buffer> {
    return this.readFile(this.requireFile(userId, bookId).filePath);
  }
  private requireFile(userId: number, bookId: number) {
    if (!this.catalog.findById(userId, bookId)) {
      throw new ReaderToolException(
        "BOOK_NOT_FOUND",
        "Book not found in the current user's library",
        "bookId",
      );
    }
    const file = this.catalog.findReadableFile(userId, bookId);
    if (!file || (file.downloadStatus !== null && file.downloadStatus !== "completed")) {
      throw new ReaderToolException(
        "BOOK_FILE_MISSING",
        "The book does not have a completed local file",
        "bookId",
      );
    }
    const extension = extname(file.fileName).toLowerCase();
    if (file.mimeType !== "application/epub+zip" && extension !== ".epub") {
      throw new ReaderToolException(
        "UNSUPPORTED_FORMAT",
        "Stage 0 reader tools currently support EPUB files only",
        "bookId",
      );
    }
    return file;
  }
  private async readFile(filePath: string): Promise<Buffer> {
    try {
      return await readFile(filePath);
    } catch (error) {
      if (typeof error === "object" && error !== null
        && (error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      throw new ReaderToolException(
        "BOOK_FILE_MISSING",
        "The stored EPUB file cannot be read",
        "bookId",
      );
    }
  }
}
