import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

describe("backend architecture boundaries", () => {
  it("keeps catalog query models out of Domain", () => {
    expect(existsSync(absolute(
      "src/modules/intelligent-library/catalog/domain/library.types.ts",
    ))).toBe(false);
    const domainFiles = [
      "book.ts",
      "book-metadata.ts",
      "book-artifact.ts",
      "source-reference.ts",
      "catalog.error.ts",
      "library.utils.ts",
    ].filter((file) => existsSync(absolute(
      `src/modules/intelligent-library/catalog/domain/${file}`,
    )));
    for (const file of domainFiles) {
      expect(moduleSpecifiers(
        `src/modules/intelligent-library/catalog/domain/${file}`,
      ).some((specifier) => specifier.includes("query-model"))).toBe(false);
    }
  });

  it("keeps Catalog Domain and Application independent from its public facade", () => {
    const files = [
      ...productionTypeScriptFiles("src/modules/intelligent-library/catalog/domain"),
      ...productionTypeScriptFiles("src/modules/intelligent-library/catalog/application"),
    ];
    for (const file of files) {
      expect(moduleSpecifiers(file).some((specifier) =>
        /(?:^|\/)public(?:\/|$)/.test(specifier)
      )).toBe(false);
    }
  });

  it("keeps acquisition file delivery behind Catalog Application", () => {
    const adapter = source(
      "src/modules/intelligent-library/catalog/infrastructure/catalog-acquisition.adapter.ts",
    );
    expect(adapter).not.toMatch(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+book_current_artifacts\b/i);
  });

  it("keeps LibraryQueries off the legacy mixed Catalog repository", () => {
    expect(existsSync(absolute(
      "src/modules/intelligent-library/catalog/application/ports/catalog-repository.port.ts",
    ))).toBe(false);
    for (const file of [
      "list-library-books.use-case.ts",
      "get-library-book.use-case.ts",
      "library-query.service.ts",
    ]) {
      expect(source(`src/modules/intelligent-library/library-queries/application/${file}`))
        .not.toContain("catalog-repository.port");
    }
    expect(source(
      "src/modules/intelligent-library/catalog/application/use-cases/create-book.use-case.ts",
    )).toContain("BookRepositoryPort");
  });

  it("keeps metadata writes off updateBookFields", () => {
    expect(source(
      "src/modules/intelligent-library/catalog/application/use-cases/update-book.use-case.ts",
    )).not.toContain("updateBookFields");
    expect(source(
      "src/modules/intelligent-library/catalog/application/apply-book-metadata.service.ts",
    )).not.toContain("updateBookFields");
  });

  it("keeps current artifact pointer DML in the Artifact repository and deletion coordinator", () => {
    expect(existsSync(absolute(
      "src/modules/intelligent-library/catalog/infrastructure/local-book-import.adapter.ts",
    ))).toBe(false);
    const owners = [
      "src/modules/intelligent-library/catalog/infrastructure/persistence/sqlite/sqlite-book-artifact.repository.ts",
      "src/modules/intelligent-library/catalog/infrastructure/persistence/sqlite/sqlite-catalog-book-deletion.repository.ts",
    ].sort();
    const dmlFiles = productionTypeScriptFiles("src")
      .filter((path) => /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+book_current_artifacts\b/i.test(source(path)))
      .filter((path) => path !== "src/platform/persistence/sqlite/sqlite.service.ts");
    expect(dmlFiles.sort()).toEqual(owners);
    expect(source(owners[0])).toMatch(/DELETE FROM book_current_artifacts[\s\S]*INSERT INTO book_current_artifacts/);
    expect(source(owners[1])).toMatch(/DELETE FROM book_current_artifacts/);
  });

  it("keeps books and source_refs DML in the SQLite Book repository", () => {
    const owner = "src/modules/intelligent-library/catalog/infrastructure/persistence/sqlite/sqlite-book.repository.ts";
    for (const [table, expectedOwners] of [
      ["books", [
        owner,
        "src/modules/intelligent-library/catalog/infrastructure/persistence/sqlite/sqlite-catalog-book-deletion.repository.ts",
      ]],
      ["source_refs", [owner]],
    ] as const) {
      const dml = new RegExp(
        `\\b(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+${table}\\b`,
        "i",
      );
      const dmlFiles = productionTypeScriptFiles("src")
        .filter((path) => dml.test(source(path)))
        .sort();
      expect(dmlFiles).toEqual([...expectedOwners].sort());
    }
  });

  it("keeps file-stream presentation independent from SQLite", () => {
    expect(moduleSpecifiers(
      "src/modules/intelligent-library/library-queries/presentation/http/stream-book-file-http.service.ts",
    )).not.toEqual(expect.arrayContaining([
      expect.stringContaining("platform/persistence/sqlite"),
      "node:sqlite",
    ]));
  });

  it("keeps book-analysis Application independent from AiModel Support", () => {
    expect(moduleSpecifiers(
      "src/modules/intelligent-library/book-analysis/application/use-cases/request-book-analysis.use-case.ts",
    ).some((specifier) => specifier.includes("support/ai-model"))).toBe(false);
  });

  it("keeps the reading-state public barrel contract-only", () => {
    expect(moduleSpecifiers("src/modules/reading-state/public/index.ts"))
      .not.toContain("../reading-state.module");
  });

  it("removes deprecated Anna's Archive and Open Library integrations", () => {
    expect(existsSync(absolute("src/integrations/annas-archive/annas-archive-search.provider.ts"))).toBe(false);
    expect(existsSync(absolute("src/integrations/open-library/openlibrary-metadata.provider.ts"))).toBe(false);
    expect(source("src/modules/acquisition/public/source-adapter.port.ts")).not.toContain("annas_archive");
    expect(source("src/modules/acquisition/acquisition.module.ts")).not.toContain("AnnasArchive");
    expect(source("src/app.module.ts")).not.toContain("OpenLibrary");
  });

  it("keeps the AI metadata provider behind the format-neutral generation use case", () => {
    const path = "src/modules/intelligent-library/metadata-enrichment/infrastructure/ai-metadata.provider.ts";
    expect(moduleSpecifiers(path)).toEqual([
      "@nestjs/common",
      "../../public",
      "../application/use-cases/generate-book-metadata.use-case",
    ]);
    expect(source(path)).not.toMatch(/\b(?:fetch|axios|Axios|HttpService|LanguageModel)\b|support\/ai-model/);
  });
});

function moduleSpecifiers(relativePath: string): string[] {
  const path = absolute(relativePath);
  const ast = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  return ast.statements.flatMap((statement) => {
    if ((!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement))
      || !statement.moduleSpecifier
      || !ts.isStringLiteral(statement.moduleSpecifier)) return [];
    return [statement.moduleSpecifier.text];
  });
}

function source(relativePath: string): string {
  return readFileSync(absolute(relativePath), "utf8");
}

function absolute(relativePath: string): string {
  return resolve(process.cwd(), relativePath);
}

function productionTypeScriptFiles(relativeDirectory: string): string[] {
  const directory = absolute(relativeDirectory);
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    const relativePath = `${relativeDirectory}/${entry}`;
    if (statSync(path).isDirectory()) return productionTypeScriptFiles(relativePath);
    return entry.endsWith(".ts") && !entry.endsWith(".spec.ts") && !entry.endsWith(".d.ts")
      ? [relativePath]
      : [];
  }).sort();
}
