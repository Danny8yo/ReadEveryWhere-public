import type { RawSearchItem, SearchSourcePort, SourceSettingsQueryPort } from "../../public";
import { SourceRegistry } from "../../source-registry/application/source-registry";
import type { SearchCachePort } from "./ports/search-cache.port";
import { SearchService } from "./search.service";

const item = (sourceBookId: string, format: "pdf" | "epub"): RawSearchItem => ({
  sourceBookId,
  title: "Same Edition",
  authors: ["Reader"],
  coverUrl: null,
  publisher: null,
  publishYear: 2026,
  editionTag: null,
  format,
  language: null,
  fileSize: null,
  filesizeString: null,
  sourceUrl: `/book/${sourceBookId}`,
  downloadPath: `/download/${sourceBookId}`,
  hash: `hash-${sourceBookId}`,
  md5: null,
  sha256: null,
  description: null,
  isbn: null,
  zlibraryInterestScore: null,
  zlibraryQualityScore: null,
});

describe("SearchService ebook format filtering", () => {
  it("passes selected formats to the provider and keeps same-edition files in different formats", async () => {
    const searchBooks = jest.fn().mockResolvedValue({
      items: [item("pdf-1", "pdf"), item("epub-1", "epub")],
      total: 2,
    });
    const source: SearchSourcePort = {
      platform: "zlibrary",
      isAvailable: () => true,
      searchBooks,
    };
    const cache: SearchCachePort = {
      find: jest.fn().mockReturnValue(null),
      save: jest.fn(),
    };
    const settings: SourceSettingsQueryPort = {
      resolveBaseUrl: () => "https://source.example.test",
    };
    const service = new SearchService(cache, new SourceRegistry([source], []), settings, 60_000);

    const result = await service.searchBooks({
      keyword: "same",
      page: 1,
      pageSize: 20,
      sourcePlatform: "zlibrary",
      formats: ["pdf", "epub"],
    } as any, "request-1", 7);

    expect(searchBooks).toHaveBeenCalledWith(
      "same",
      1,
      20,
      "request-1",
      "https://source.example.test",
      ["pdf", "epub"],
    );
    expect(result.items.map((entry) => entry.formats[0])).toEqual(["pdf", "epub"]);
  });
});
