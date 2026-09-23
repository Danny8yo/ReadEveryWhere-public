import type { DoubanRatingSourcePort } from "../../public";
import type { DoubanSettingsPort } from "./ports/douban-settings.port";

export class SearchDoubanRatingUseCase {
  constructor(
    private readonly source: DoubanRatingSourcePort,
    private readonly settings: DoubanSettingsPort,
    private readonly defaultCookie: string,
  ) {}

  execute(userId: number | undefined, keyword: string, requestId: string) {
    const userCookie = userId === undefined ? "" : this.settings.getCookie(userId);
    return this.source.searchRatingCandidates(
      keyword,
      requestId,
      userCookie || this.defaultCookie,
    );
  }
}
