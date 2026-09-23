import type { SourceSettingsQueryPort } from "../../public";
import type { SourceSettingsStorePort } from "./ports/source-settings-store.port";

export class SourceSettingsQueryService implements SourceSettingsQueryPort {
  constructor(
    private readonly store: SourceSettingsStorePort,
    private readonly defaultZlibraryBaseUrl: string,
  ) {}

  resolveBaseUrl(query: { sourcePlatform: "zlibrary"; userId?: number }): string {
    if (query.userId !== undefined) {
      const perUser = this.store.findByUserId(query.userId)?.baseUrl?.trim();
      if (perUser) return stripTrailingSlash(perUser);
    }
    return stripTrailingSlash(this.defaultZlibraryBaseUrl);
  }
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
