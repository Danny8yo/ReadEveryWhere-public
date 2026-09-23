import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("catalog query adapter boundaries", () => {
  const catalogRoot = resolve(__dirname, "..");
  const moduleSource = readFileSync(resolve(catalogRoot, "catalog.module.ts"), "utf8");

  it("registers one adapter per query responsibility instead of LibraryRepository", () => {
    expect(moduleSource).not.toContain("LibraryRepository");
    expect(moduleSource).toContain("SqliteBookDuplicateQuery");
    expect(moduleSource).toContain("SqliteCatalogBookViewQuery");
    expect(moduleSource).toContain("SqliteBookContentCatalogQuery");
    expect(moduleSource).toContain("SqliteBookFileStreamingQuery");
  });

  it("removes the former wide adapter", () => {
    expect(existsSync(resolve(__dirname, "library.repository.ts"))).toBe(false);
  });
});
