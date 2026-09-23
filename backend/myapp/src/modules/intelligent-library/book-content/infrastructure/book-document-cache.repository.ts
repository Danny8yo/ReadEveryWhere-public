import { Injectable } from "@nestjs/common";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { BookDocument, ContentRevision } from "../domain/book-document.types";
import type { BookDocumentCachePort } from "../application/ports/book-document-cache.port";

@Injectable()
export class BookDocumentCacheRepository implements BookDocumentCachePort {
  private readonly cacheRoot = resolve(
    process.cwd(),
    process.env.READER_CONTENT_CACHE_PATH ?? "data/reader-content",
  );

  async load(userId: number, bookId: number, revision: ContentRevision): Promise<BookDocument | null> {
    try {
      const raw = await readFile(this.cachePath(userId, bookId, revision), "utf8");
      const parsed = JSON.parse(raw) as BookDocument;
      if (
        parsed.bookId !== bookId
        || parsed.revision.fileChecksum !== revision.fileChecksum
        || parsed.revision.extractorVersion !== revision.extractorVersion
        || parsed.revision.normalizationVersion !== revision.normalizationVersion
        || !Array.isArray(parsed.sections)
        || !Array.isArray(parsed.toc)
      ) {
        return null;
      }
      return parsed;
    } catch (error) {
      if (isCacheMiss(error)) return null;
      throw error;
    }
  }

  async save(userId: number, document: BookDocument): Promise<void> {
    await mkdir(this.cacheRoot, { recursive: true });
    const target = this.cachePath(userId, document.bookId, document.revision);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(document), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, target);
  }

  private cachePath(userId: number, bookId: number, revision: ContentRevision): string {
    const checksum = revision.fileChecksum.replace(/^sha256:/u, "");
    return resolve(
      this.cacheRoot,
      `${userId}-${bookId}-${checksum}-${revision.extractorVersion}-${revision.normalizationVersion}.json`,
    );
  }
}

function isCacheMiss(error: unknown): boolean {
  if (error instanceof SyntaxError) return true;
  return typeof error === "object" && error !== null
    && (error as NodeJS.ErrnoException).code === "ENOENT";
}
