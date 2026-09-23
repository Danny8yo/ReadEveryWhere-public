import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { SqliteService } from "../../../../platform/persistence/sqlite/sqlite.service";
import type { SearchPageResult } from "../domain/search-result.types";
import { SqliteSearchCacheRepository } from "./sqlite-search-cache.repository";

describe("SqliteSearchCacheRepository format isolation", () => {
  it("keeps the same keyword and page separate for different format selections", () => {
    const root = mkdtempSync(resolve(tmpdir(), "search-cache-formats-"));
    const previous = process.env.SQLITE_PATH;
    process.env.SQLITE_PATH = resolve(root, "cache.sqlite");
    const sqlite = new SqliteService();
    try {
      sqlite.onModuleInit();
      const repository = new SqliteSearchCacheRepository(sqlite);
      const result = (format: "pdf" | "epub"): SearchPageResult => ({
        items: [{ id: format, sourceBookId: format, sourcePlatform: "zlibrary", title: format,
          authors: [], publisher: null, publishYear: null, editionTag: null, identifier: null,
          language: null, formats: [format], fileSize: null, fileSizeText: null, coverUrl: null,
          description: null, sourceUrl: null, downloadPath: null, downloadable: false,
          availability: "unavailable", hash: null, md5: null, sha256: null,
          zlibraryInterestScore: null, zlibraryQualityScore: null }],
        total: 1, page: 1, pageSize: 20, hasNext: false, nextPage: null,
        requestId: `request-${format}`, warnings: [],
      });
      const key = { keyword: "same", sourcePlatform: "zlibrary", page: 1, pageSize: 20 };

      repository.save({ ...key, formats: ["pdf"] }, result("pdf"));
      repository.save({ ...key, formats: ["epub"] }, result("epub"));

      expect(repository.find({ ...key, formats: ["pdf"] }, 60_000)?.items[0].formats).toEqual(["pdf"]);
      expect(repository.find({ ...key, formats: ["epub"] }, 60_000)?.items[0].formats).toEqual(["epub"]);
    } finally {
      sqlite.onApplicationShutdown();
      rmSync(root, { recursive: true, force: true });
      if (previous === undefined) delete process.env.SQLITE_PATH;
      else process.env.SQLITE_PATH = previous;
    }
  });
});
