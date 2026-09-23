import type { DownloadSourcePort, SearchSourcePort } from "../../public";
import { SourceRegistry } from "./source-registry";

function searchSource(platform: SearchSourcePort["platform"]): SearchSourcePort {
  return {
    platform,
    isAvailable: () => true,
    searchBooks: jest.fn(),
  };
}

function downloadSource(platform: DownloadSourcePort["platform"]): DownloadSourcePort {
  return {
    platform,
    download: jest.fn(),
  };
}

describe("SourceRegistry", () => {
  it("selects sources by capability and platform", () => {
    const zlibrarySearch = searchSource("zlibrary");
    const zlibraryDownload = downloadSource("zlibrary");
    const registry = new SourceRegistry(
      [zlibrarySearch],
      [zlibraryDownload],
    );

    expect(registry.searchesFor("all")).toEqual([zlibrarySearch]);
    expect(registry.searchesFor("zlibrary")).toEqual([zlibrarySearch]);
    expect(registry.downloadFor("zlibrary")).toBe(zlibraryDownload);
  });

  it("allows one source to contribute different capabilities", () => {
    const registry = new SourceRegistry(
      [searchSource("zlibrary")],
      [downloadSource("zlibrary")],
    );

    expect(registry.searchesFor("zlibrary")).toHaveLength(1);
    expect(registry.downloadFor("zlibrary")).not.toBeNull();
  });

  it("fails fast when two adapters register the same capability and platform", () => {
    expect(() => new SourceRegistry(
      [searchSource("zlibrary"), searchSource("zlibrary")],
      [],
    )).toThrow("Duplicate search source: zlibrary");

    expect(() => new SourceRegistry(
      [],
      [downloadSource("zlibrary"), downloadSource("zlibrary")],
    )).toThrow("Duplicate download source: zlibrary");
  });
});
