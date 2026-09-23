import type {
  MetadataSourceContextPort,
  MetadataSourcePort,
  MetadataSourceRequest,
  ScrapedBook,
} from "../../public";
import type { CatalogBookViewQueryPort } from "../../catalog/application/ports/catalog-book-view-query.port";
import { CatalogError } from "../../catalog/domain/catalog.error";
import type { DoubanSettingsPort } from "./ports/douban-settings.port";
import {
  matchAndRankMetadataCandidates,
  type MatchedMetadataCandidate,
} from "./metadata-candidate.matcher";

export class MetadataOrchestratorService {
  constructor(
    private readonly sourceContext: MetadataSourceContextPort,
    private readonly doubanSettings: DoubanSettingsPort,
    private readonly providers: readonly MetadataSourcePort[],
    private readonly defaultDoubanCookie: string,
    private readonly catalogBooks: CatalogBookViewQueryPort,
  ) {}

  async scrape(provider: string, input: {
    userId: number;
    requestId: string;
    keyword?: string;
    bookId: number;
  }): Promise<MatchedMetadataCandidate[]> {
    const normalizedProvider = provider.trim();
    const source = this.providers.find((candidate) => candidate.platform === normalizedProvider);
    if (!source) throw new Error(`Unknown metadata provider: ${normalizedProvider}`);
    const book = this.catalogBooks.getBook(input.userId, input.bookId);
    if (!book) throw CatalogError.notFound("bookId", "Book not found");
    const request: MetadataSourceRequest = {
      userId: input.userId,
      requestId: input.requestId,
      keyword: input.keyword,
      bookId: normalizedProvider === "AI" ? input.bookId : undefined,
    };

    if (normalizedProvider === "zlibrary") {
      request.baseUrl = this.sourceContext.resolveZlibraryBaseUrl(input.userId);
    } else if (normalizedProvider === "douban") {
      const cookie = this.doubanSettings.getCookie(input.userId) || this.defaultDoubanCookie;
      if (cookie) request.cookie = cookie;
    }
    const candidates: ScrapedBook[] = await source.search(request);
    return matchAndRankMetadataCandidates(book, candidates);
  }
}
