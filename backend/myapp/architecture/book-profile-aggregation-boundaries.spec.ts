import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

describe("Book/Profile aggregation migration boundaries", () => {
  it("enforces the final Book/Profile ownership boundaries", () => {
    const actual = new Set<string>();
    const catalogProfile = "src/modules/intelligent-library/catalog/domain/book-reading-profile.ts";
    const bookRepository = source(
      "src/modules/intelligent-library/catalog/infrastructure/persistence/sqlite/sqlite-book.repository.ts",
    );

    if (!existsSync(resolve(root, catalogProfile))) {
      actual.add("formal-profile-owned-by-book-analysis");
    }
    if (!/\bbook_profiles\b/.test(bookRepository)) {
      actual.add("book-repository-does-not-persist-profile");
    }
    expect([...actual].sort()).toEqual([]);
  });

  it("keeps formal book_profiles DML in the Book repository", () => {
    const dmlFiles = productionFiles("src")
      .filter((path) => /\b(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+book_profiles\b/i.test(source(path)))
      .sort();
    expect(dmlFiles).toEqual([
      "src/modules/intelligent-library/catalog/infrastructure/persistence/sqlite/sqlite-book.repository.ts",
    ].sort());
  });

  it("routes candidate application through a Catalog Application Port", () => {
    const application = source(
      "src/modules/intelligent-library/book-analysis/application/use-cases/apply-book-analysis-candidate.use-case.ts",
    );
    expect(application).not.toMatch(/BookRepositoryPort/);
    expect(application).toMatch(/ApplyBookReadingProfileCandidatePort/);
  });

  it("keeps the BookAnalysis repository off the formal profile table", () => {
    const analysisRepository = source(
      "src/modules/intelligent-library/book-analysis/infrastructure/book-analysis.repository.ts",
    );
    expect(analysisRepository).not.toMatch(/\bbook_profiles\b/);
  });
});

function source(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function productionFiles(relativeDirectory: string): string[] {
  const directory = resolve(root, relativeDirectory);
  const entries = require("node:fs").readdirSync(directory) as string[];
  return entries.flatMap((entry) => {
    const relativePath = `${relativeDirectory}/${entry}`;
    const absolute = resolve(root, relativePath);
    if (require("node:fs").statSync(absolute).isDirectory()) return productionFiles(relativePath);
    return entry.endsWith(".ts") && !entry.endsWith(".spec.ts") ? [relativePath] : [];
  });
}
