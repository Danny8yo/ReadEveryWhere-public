import { EPUB_EXTRACTOR_VERSION } from "@readeverywhere/epub-core";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectorEpubFixtures } from "../../../../../tools/book-document-inspector/fixtures/epub-fixtures";
import { BookDocumentCacheRepository } from "./book-document-cache.repository";
import {
  EPUB_NORMALIZATION_VERSION,
  EpubDocumentExtractor,
} from "./epub-document.extractor";

describe("BookDocumentCacheRepository", () => {
  let cacheRoot: string;
  let previousCachePath: string | undefined;

  beforeEach(async () => {
    cacheRoot = await mkdtemp(join(tmpdir(), "rew-book-document-cache-"));
    previousCachePath = process.env.READER_CONTENT_CACHE_PATH;
    process.env.READER_CONTENT_CACHE_PATH = cacheRoot;
  });

  afterEach(async () => {
    if (previousCachePath === undefined) delete process.env.READER_CONTENT_CACHE_PATH;
    else process.env.READER_CONTENT_CACHE_PATH = previousCachePath;
    await rm(cacheRoot, { recursive: true, force: true });
  });

  it("does not reuse a v3 cache entry for the v4 extractor revision", async () => {
    const fixture = inspectorEpubFixtures.find((item) => item.id === "single-section")!;
    const v3Revision = {
      fileChecksum: "sha256:stable-checksum",
      extractorVersion: "epub-extractor-v3",
      normalizationVersion: EPUB_NORMALIZATION_VERSION,
    };
    const repository = new BookDocumentCacheRepository();
    const v3Document = await new EpubDocumentExtractor().extract(42, fixture.epub, v3Revision);
    await repository.save(7, v3Document);

    await expect(repository.load(7, 42, v3Revision)).resolves.toEqual(v3Document);
    await expect(repository.load(7, 42, {
      ...v3Revision,
      extractorVersion: EPUB_EXTRACTOR_VERSION,
    })).resolves.toBeNull();
  });
});
