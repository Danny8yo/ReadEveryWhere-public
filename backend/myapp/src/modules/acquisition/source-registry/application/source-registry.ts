import type {
  DownloadSourcePort,
  SearchSourcePort,
  SourcePlatform,
} from "../../public";

export class SourceRegistry {
  private readonly searchSources: ReadonlyMap<SourcePlatform, SearchSourcePort>;
  private readonly downloadSources: ReadonlyMap<SourcePlatform, DownloadSourcePort>;

  constructor(searchSources: SearchSourcePort[], downloadSources: DownloadSourcePort[]) {
    this.searchSources = uniqueSources(searchSources, "search");
    this.downloadSources = uniqueSources(downloadSources, "download");
  }

  searchesFor(platform: SourcePlatform | "all"): SearchSourcePort[] {
    if (platform === "all") return [...this.searchSources.values()];
    const source = this.searchSources.get(platform);
    return source ? [source] : [];
  }

  downloadFor(platform: SourcePlatform): DownloadSourcePort | null {
    return this.downloadSources.get(platform) ?? null;
  }
}

function uniqueSources<T extends { readonly platform: SourcePlatform }>(
  sources: T[],
  capability: string,
): ReadonlyMap<SourcePlatform, T> {
  const result = new Map<SourcePlatform, T>();
  for (const source of sources) {
    if (result.has(source.platform)) {
      throw new Error(`Duplicate ${capability} source: ${source.platform}`);
    }
    result.set(source.platform, source);
  }
  return result;
}
