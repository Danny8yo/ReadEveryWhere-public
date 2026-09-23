import { MetadataOrchestratorService } from "./metadata-orchestrator.service";
import type { MetadataSourcePort, ScrapedBook } from "../../public";
import { CatalogError } from "../../catalog/domain/catalog.error";

describe("MetadataOrchestratorService provider context", () => {
  it("resolves only the Z-Library base URL for the zlibrary provider", async () => {
    const fixture = createFixture();

    await fixture.service.scrape("zlibrary", request());

    expect(fixture.sourceContext.resolveZlibraryBaseUrl).toHaveBeenCalledWith(7);
    expect(fixture.doubanSettings.getCookie).not.toHaveBeenCalled();
    expect(fixture.zlibrary.search).toHaveBeenCalledWith({
      userId: 7,
      requestId: "req-1",
      keyword: "Book",
      bookId: undefined,
      baseUrl: "https://zlibrary.example",
    });
  });

  it("reads and forwards a Cookie only for the douban provider", async () => {
    const fixture = createFixture({ userCookie: "dbcl2=user-cookie" });

    await fixture.service.scrape("douban", request());

    expect(fixture.sourceContext.resolveZlibraryBaseUrl).not.toHaveBeenCalled();
    expect(fixture.doubanSettings.getCookie).toHaveBeenCalledWith(7);
    expect(fixture.douban.search).toHaveBeenCalledWith({
      userId: 7,
      requestId: "req-1",
      keyword: "Book",
      bookId: undefined,
      cookie: "dbcl2=user-cookie",
    });
  });

  it("does not read provider credentials for AI", async () => {
    const fixture = createFixture();

    await fixture.service.scrape("AI", { ...request(), keyword: undefined, bookId: 42 });

    expect(fixture.sourceContext.resolveZlibraryBaseUrl).not.toHaveBeenCalled();
    expect(fixture.doubanSettings.getCookie).not.toHaveBeenCalled();
    expect(fixture.ai.search).toHaveBeenCalledWith({
      userId: 7,
      requestId: "req-1",
      keyword: undefined,
      bookId: 42,
    });
  });

  it("ranks all external provider candidates against the selected book", async () => {
    const fixture = createFixture();
    fixture.douban.search.mockResolvedValue([
      scraped({ sourceBookId: "wrong", isbn: "9780000000001" }),
      scraped({ sourceBookId: "edition", isbn: "9787300172621" }),
    ]);

    const result = await fixture.service.scrape("douban", request());

    expect(result.map((item) => [item.candidate.sourceBookId, item.match.level])).toEqual([
      ["edition", "edition"],
      ["wrong", "conflict"],
    ]);
    expect(fixture.catalogBooks.getBook).toHaveBeenCalledWith(7, 42);
  });

  it("fails when the selected book does not belong to the user", async () => {
    const fixture = createFixture();
    fixture.catalogBooks.getBook.mockReturnValue(null);

    await expect(fixture.service.scrape("zlibrary", request())).rejects.toEqual(
      CatalogError.notFound("bookId", "Book not found"),
    );
    expect(fixture.zlibrary.search).not.toHaveBeenCalled();
  });
});

function request() {
  return { userId: 7, requestId: "req-1", keyword: "Book", bookId: 42 };
}

function createFixture(options: { userCookie?: string; defaultCookie?: string } = {}) {
  const sourceContext = {
    resolveZlibraryBaseUrl: jest.fn().mockReturnValue("https://zlibrary.example"),
  };
  const doubanSettings = {
    getCookie: jest.fn().mockReturnValue(options.userCookie ?? ""),
    upsertCookie: jest.fn(),
  };
  const zlibrary = provider("zlibrary");
  const douban = provider("douban");
  const ai = provider("AI");
  const catalogBooks = {
    getBook: jest.fn().mockReturnValue({
      id: 42,
      userId: 7,
      title: "策略思维——商界、政界及日常生活中的策略竞争",
      authors: ["阿维纳什·迪克西特"],
      isbn: "9787300172621",
    }),
  };
  return {
    sourceContext,
    doubanSettings,
    zlibrary,
    douban,
    ai,
    catalogBooks,
    service: new MetadataOrchestratorService(
      sourceContext,
      doubanSettings,
      [zlibrary, douban, ai],
      options.defaultCookie ?? "",
      catalogBooks,
    ),
  };
}

function scraped(overrides: Partial<ScrapedBook> = {}): ScrapedBook {
  return {
    title: "策略思维——商界、政界及日常生活中的策略竞争",
    authors: ["阿维纳什·迪克西特"],
    isbn: null,
    publisher: null,
    publishYear: null,
    description: null,
    coverUrl: null,
    language: "zh",
    editionTag: null,
    sourcePlatform: "douban",
    sourceBookId: "subject-1",
    sourceUrl: "https://book.douban.com/subject/subject-1/",
    ...overrides,
  };
}

function provider(platform: string): jest.Mocked<MetadataSourcePort> {
  return {
    platform,
    search: jest.fn().mockResolvedValue([]),
  };
}
