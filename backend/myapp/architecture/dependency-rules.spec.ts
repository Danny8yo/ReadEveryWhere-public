import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import ts from "typescript";
import {
  APPROVED_TABLE_ACCESS,
  LEGACY_DEPENDENCY_ALLOWLIST,
  LEGACY_ROOT_FILES,
  LEGACY_TABLE_ACCESS_ALLOWLIST,
  LEGACY_TOP_LEVEL_DIRECTORIES,
} from "./legacy-allowlist";

const projectRoot = resolve(__dirname, "..");
const sourceRoot = resolve(projectRoot, "src");

const targetTopLevelDirectories = new Set([
  "@types",
  "integrations",
  "interface-adapters",
  "modules",
  "platform",
  "support",
]);

const targetRootFiles = new Set(["app.module.ts", "main.ts"]);

const legacyOwnerByDirectory: Record<string, string> = {
  "ai-model": "ai-model-support",
  "ai-reading": "ai-reading",
  annotations: "reading-state",
  auth: "identity",
  "book-analysis": "intelligent-library",
  "book-content": "intelligent-library",
  bookmarks: "reading-state",
  common: "platform",
  database: "platform",
  download: "acquisition",
  library: "intelligent-library",
  metadata: "intelligent-library",
  "reading-progress": "reading-state",
  search: "acquisition",
  user: "acquisition",
};

const businessLegacyDirectories = new Set(
  Object.entries(legacyOwnerByDirectory)
    .filter(([, owner]) => owner !== "platform" && owner !== "ai-model-support")
    .map(([directory]) => directory),
);

const tableOwner: Record<string, string> = {
  users: "identity",
  refresh_tokens: "identity",
  ai_access_tokens: "identity",
  books: "intelligent-library",
  source_refs: "intelligent-library",
  book_artifacts: "intelligent-library",
  book_current_artifacts: "intelligent-library",
  book_profiles: "intelligent-library",
  book_douban_ratings: "intelligent-library",
  search_cache: "acquisition",
  download_tasks: "acquisition",
  user_zlibrary_config: "acquisition",
  user_douban_config: "intelligent-library",
  annotations: "reading-state",
  bookmarks: "reading-state",
  reading_progress: "reading-state",
  ai_model_configs: "ai-model-support",
  book_analysis_candidates: "intelligent-library",
  book_analysis_tasks: "intelligent-library",
  ai_reading_tasks: "ai-reading",
  reading_conversations: "ai-reading",
  reading_conversation_turns: "ai-reading",
  reading_conversation_checkpoints: "ai-reading",
  ai_reading_agent_runs: "ai-reading",
  ai_reading_agent_steps: "ai-reading",
  ai_reading_task_budgets: "ai-reading",
  ai_reading_budget_reservations: "ai-reading",
  ai_reading_messages: "ai-reading",
  ai_reading_events: "ai-reading",
  ai_reading_evidence: "ai-reading",
  ai_reading_audit: "ai-reading",
  selection_qa_conversations: "ai-reading",
  selection_qa_turns: "ai-reading",
  selection_qa_events: "ai-reading",
  selection_qa_evidence: "ai-reading",
  selection_qa_commands: "ai-reading",
  annotation_selection_commands: "reading-state",
  content_index_generations: "book-content",
  content_index_current: "book-content",
  content_index_chunks: "book-content",
  content_index_fts: "book-content",
  schema_migrations: "platform",
};

interface ImportReference {
  line: number;
  specifier: string;
  target: string | null;
}

interface SourceRecord {
  absolutePath: string;
  relativePath: string;
  sourceFile: ts.SourceFile;
  imports: ImportReference[];
}

function normalizePath(path: string): string {
  return path.split(sep).join("/");
}

function sourceFilesBelow(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const absolutePath = resolve(directory, entry);
    if (statSync(absolutePath).isDirectory())
      files.push(...sourceFilesBelow(absolutePath));
    else if (
      entry.endsWith(".ts") &&
      !entry.endsWith(".spec.ts") &&
      !entry.endsWith(".d.ts")
    ) {
      files.push(absolutePath);
    }
  }
  return files;
}

function resolveImport(sourcePath: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  return normalizePath(
    relative(projectRoot, resolve(dirname(sourcePath), specifier)),
  );
}

function collectImports(
  sourceFile: ts.SourceFile,
  absolutePath: string,
): ImportReference[] {
  const imports: ImportReference[] = [];
  const add = (node: ts.Node, specifier: string) => {
    imports.push({
      line:
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1,
      specifier,
      target: resolveImport(absolutePath, specifier),
    });
  };
  const visit = (node: ts.Node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      add(node, node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      add(node, node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      add(node, node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return imports;
}

function loadSources(): SourceRecord[] {
  return sourceFilesBelow(sourceRoot)
    .sort()
    .map((absolutePath) => {
      const sourceFile = ts.createSourceFile(
        absolutePath,
        readFileSync(absolutePath, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      return {
        absolutePath,
        relativePath: normalizePath(relative(projectRoot, absolutePath)),
        sourceFile,
        imports: collectImports(sourceFile, absolutePath),
      };
    });
}

function topDirectory(path: string): string | null {
  const match = /^src\/([^/]+)/.exec(path);
  return match?.[1] ?? null;
}

function targetBusinessModule(path: string): string | null {
  return /^src\/modules\/([^/]+)/.exec(path)?.[1] ?? null;
}

function ownerForSource(path: string): string | null {
  const targetModule = targetBusinessModule(path);
  if (targetModule) return targetModule;
  if (path.startsWith("src/support/ai-model/")) return "ai-model-support";
  if (path.startsWith("src/platform/")) return "platform";
  const directory = topDirectory(path);
  return directory ? (legacyOwnerByDirectory[directory] ?? null) : null;
}

function dependencyKey(
  rule: string,
  source: SourceRecord,
  item: ImportReference,
): string {
  return `${rule}|${source.relativePath}:${item.line}|${item.specifier}`;
}

function isOuterLayerTarget(target: string | null): boolean {
  return Boolean(
    target &&
    (target.includes("/infrastructure/") ||
      target.includes("/presentation/") ||
      target.startsWith("src/platform/")),
  );
}

function dependencyViolations(sources: SourceRecord[]): string[] {
  const violations = new Set<string>();

  for (const source of sources) {
    const sourceLegacyDirectory = topDirectory(source.relativePath);
    const sourceTargetModule = targetBusinessModule(source.relativePath);
    const isTargetDomain = /^src\/modules\/[^/]+\/(?:[^/]+\/)?domain\//.test(
      source.relativePath,
    );
    const isTargetApplication =
      /^src\/modules\/[^/]+\/(?:[^/]+\/)?application\//.test(
        source.relativePath,
      );
    const isLegacyApplication = Boolean(
      sourceLegacyDirectory &&
      legacyOwnerByDirectory[sourceLegacyDirectory] &&
      source.relativePath.includes("/application/"),
    );

    for (const item of source.imports) {
      if (isTargetDomain) {
        if (
          item.specifier.startsWith("@nestjs/") ||
          isOuterLayerTarget(item.target) ||
          item.target?.startsWith("src/integrations/")
        ) {
          violations.add(dependencyKey("target-domain-layer", source, item));
        }
      }

      if (isTargetApplication) {
        if (
          item.specifier.startsWith("@nestjs/") ||
          isOuterLayerTarget(item.target)
        ) {
          violations.add(
            dependencyKey("target-application-layer", source, item),
          );
        }
      }

      if (isLegacyApplication) {
        if (item.specifier.startsWith("@nestjs/")) {
          violations.add(
            dependencyKey("legacy-application-nest", source, item),
          );
        }
        if (isOuterLayerTarget(item.target)) {
          violations.add(
            dependencyKey("legacy-application-outer-layer", source, item),
          );
        }
      }

      const targetTargetModule = item.target
        ? targetBusinessModule(item.target)
        : null;
      // One real composition-only consumer: Nest imports the owning module,
      // while all SelectionQA application/infrastructure calls use public Ports.
      const selectionQaReadingStateWiring =
        source.relativePath ===
          "src/modules/ai-reading/selection-qa/selection-qa.module.ts" &&
        item.target === "src/modules/reading-state/reading-state.module";
      if (
        sourceTargetModule &&
        targetTargetModule &&
        sourceTargetModule !== targetTargetModule &&
        !item.target?.startsWith(`src/modules/${targetTargetModule}/public`) &&
        !selectionQaReadingStateWiring
      ) {
        violations.add(
          dependencyKey("target-cross-module-public", source, item),
        );
      }

      const targetLegacyDirectory = item.target
        ? topDirectory(item.target)
        : null;
      if (
        sourceLegacyDirectory &&
        targetLegacyDirectory &&
        businessLegacyDirectories.has(sourceLegacyDirectory) &&
        businessLegacyDirectories.has(targetLegacyDirectory) &&
        legacyOwnerByDirectory[sourceLegacyDirectory] !==
          legacyOwnerByDirectory[targetLegacyDirectory]
      ) {
        violations.add(
          dependencyKey("legacy-cross-business-module", source, item),
        );
      }

      if (
        source.relativePath.startsWith("src/library/") &&
        item.target?.startsWith("src/book-analysis/")
      ) {
        violations.add(
          dependencyKey("legacy-catalog-book-analysis", source, item),
        );
      }

      if (
        source.relativePath.startsWith("src/book-content/") &&
        item.target?.startsWith("src/annotations/")
      ) {
        violations.add(
          dependencyKey("legacy-book-content-reading-state", source, item),
        );
      }

      if (
        source.relativePath.startsWith("src/platform/") &&
        item.target &&
        /^(src\/(?:modules|support|integrations)\/)/.test(item.target)
      ) {
        violations.add(
          dependencyKey("platform-dependency-direction", source, item),
        );
      }

      if (
        source.relativePath.startsWith("src/integrations/") &&
        item.target &&
        /^(src\/(?:modules|support)\/)/.test(item.target) &&
        !item.target.includes("/public")
      ) {
        violations.add(dependencyKey("integration-public-port", source, item));
      }

      if (
        source.relativePath.startsWith(
          "src/modules/intelligent-library/catalog/",
        ) &&
        item.target &&
        /^src\/modules\/intelligent-library\/(?:metadata-enrichment|book-analysis)\//.test(
          item.target,
        )
      ) {
        violations.add(
          dependencyKey("catalog-dependency-direction", source, item),
        );
      }

      if (
        source.relativePath.startsWith("src/modules/intelligent-library/") &&
        item.target?.startsWith("src/modules/acquisition/")
      ) {
        violations.add(
          dependencyKey(
            "intelligent-library-acquisition-direction",
            source,
            item,
          ),
        );
      }

      if (
        source.relativePath.endsWith("/public/index.ts") &&
        item.target &&
        (item.target.includes("/infrastructure/") ||
          item.target.includes("/presentation/"))
      ) {
        violations.add(
          dependencyKey("public-barrel-private-export", source, item),
        );
      }
    }

    if (source.relativePath !== "src/app.module.ts") {
      const importsIntegration = source.imports.some((item) =>
        item.target?.startsWith("src/integrations/"),
      );
      const importedBusinessModules = new Set(
        source.imports
          .map((item) =>
            item.target ? targetBusinessModule(item.target) : null,
          )
          .filter(
            (moduleName) => moduleName && moduleName !== sourceTargetModule,
          ),
      );
      if (importsIntegration && importedBusinessModules.size > 1) {
        violations.add(
          `composition-root-binding|${source.relativePath}:1|multiple-modules-and-integration`,
        );
      }
    }
  }

  return [...violations].sort();
}

function tableAccesses(
  source: SourceRecord,
): Array<{ operation: "READ" | "WRITE"; table: string; line: number }> {
  const accesses: Array<{
    operation: "READ" | "WRITE";
    table: string;
    line: number;
  }> = [];
  const seen = new Set<string>();
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateExpression(node)
    ) {
      const sql = node.getText(source.sourceFile).slice(1, -1);
      const line =
        source.sourceFile.getLineAndCharacterOfPosition(
          node.getStart(source.sourceFile),
        ).line + 1;
      const add = (operation: "READ" | "WRITE", table: string) => {
        const normalizedTable = table.toLowerCase();
        if (!tableOwner[normalizedTable]) return;
        const key = `${operation}|${normalizedTable}|${line}`;
        if (!seen.has(key)) {
          accesses.push({ operation, table: normalizedTable, line });
          seen.add(key);
        }
      };

      for (const match of sql.matchAll(
        /\bINSERT(?:\s+OR\s+\w+)?\s+INTO\s+([a-z_][a-z0-9_]*)/gi,
      )) {
        add("WRITE", match[1]);
      }
      for (const match of sql.matchAll(/\bUPDATE\s+([a-z_][a-z0-9_]*)/gi))
        add("WRITE", match[1]);
      for (const match of sql.matchAll(
        /\bDELETE\s+FROM\s+([a-z_][a-z0-9_]*)/gi,
      ))
        add("WRITE", match[1]);

      if (/\bSELECT\b/i.test(sql)) {
        for (const match of sql.matchAll(
          /\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/gi,
        )) {
          add("READ", match[1]);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source.sourceFile);
  return accesses;
}

// Schema declarations own database-wide DDL, including trigger bodies. Keep this
// exact list separate from business Adapter exceptions; arbitrary platform SQL
// and module SQL still pass through the unchanged ownership checks below.
const PLATFORM_SCHEMA_DECLARATIONS = new Set([
  "src/platform/persistence/sqlite/schema-baseline.ts",
  "src/platform/persistence/sqlite/schema-current.ts",
  "src/platform/persistence/sqlite/schema-selection-qa.ts",
  "src/platform/persistence/sqlite/schema-index.ts",
  "src/platform/persistence/sqlite/schema-selection-qa-runtime.ts",
]);

function tableAccessViolations(sources: SourceRecord[]): string[] {
  const violations: string[] = [];
  for (const source of sources) {
    if (PLATFORM_SCHEMA_DECLARATIONS.has(source.relativePath)) continue;
    const owner = ownerForSource(source.relativePath);
    for (const access of tableAccesses(source)) {
      if (owner === tableOwner[access.table]) continue;
      if (
        tableOwner[access.table] === "book-content" &&
        source.relativePath.startsWith(
          "src/modules/intelligent-library/book-content/",
        )
      )
        continue;
      const approvedKey = `${access.operation}|${access.table}|${source.relativePath}`;
      if (APPROVED_TABLE_ACCESS.has(approvedKey)) continue;
      violations.push(`${approvedKey}:${access.line}`);
    }
  }
  return violations.sort();
}

describe("target backend architecture", () => {
  const sources = loadSources();

  it("allows only target directories or explicit legacy top-level debt", () => {
    const unexpectedDirectories = readdirSync(sourceRoot)
      .filter((entry) => statSync(resolve(sourceRoot, entry)).isDirectory())
      .filter(
        (entry) =>
          !targetTopLevelDirectories.has(entry) &&
          !LEGACY_TOP_LEVEL_DIRECTORIES.has(entry),
      );
    const staleAllowlistEntries = [...LEGACY_TOP_LEVEL_DIRECTORIES].filter(
      (entry) => !existsSync(resolve(sourceRoot, entry)),
    );
    expect({ unexpectedDirectories, staleAllowlistEntries }).toEqual({
      unexpectedDirectories: [],
      staleAllowlistEntries: [],
    });
  });

  it("allows only target root files or explicit legacy root-file debt", () => {
    const rootFiles = readdirSync(sourceRoot).filter((entry) =>
      statSync(resolve(sourceRoot, entry)).isFile(),
    );
    const unexpectedFiles = rootFiles.filter(
      (entry) =>
        entry.endsWith(".ts") &&
        !entry.endsWith(".d.ts") &&
        !targetRootFiles.has(entry) &&
        !LEGACY_ROOT_FILES.has(entry),
    );
    const staleAllowlistEntries = [...LEGACY_ROOT_FILES].filter(
      (entry) => !existsSync(resolve(sourceRoot, entry)),
    );
    expect({ unexpectedFiles, staleAllowlistEntries }).toEqual({
      unexpectedFiles: [],
      staleAllowlistEntries: [],
    });
  });

  it("enforces layers, public module boundaries, and dependency direction", () => {
    const actual = dependencyViolations(sources);
    const unapproved = actual.filter(
      (key) => !LEGACY_DEPENDENCY_ALLOWLIST.has(key),
    );
    const staleAllowlistEntries = [...LEGACY_DEPENDENCY_ALLOWLIST].filter(
      (key) => !actual.includes(key),
    );
    expect({ unapproved, staleAllowlistEntries }).toEqual({
      unapproved: [],
      staleAllowlistEntries: [],
    });
  });

  it("limits platform schema exceptions to immutable SQL declarations", () => {
    for (const path of PLATFORM_SCHEMA_DECLARATIONS) {
      const schema = sources.find((source) => source.relativePath === path);
      expect(schema).toBeDefined();
      expect(schema!.sourceFile.statements).toHaveLength(1);
      const statement = schema!.sourceFile.statements[0];
      expect(ts.isVariableStatement(statement)).toBe(true);
      if (!ts.isVariableStatement(statement))
        throw new Error(`Invalid schema declaration: ${path}`);
      expect(statement.declarationList.flags & ts.NodeFlags.Const).toBeTruthy();
      expect(statement.declarationList.declarations).toHaveLength(1);
      expect(statement.declarationList.declarations[0].initializer?.kind).toBe(
        ts.SyntaxKind.NoSubstitutionTemplateLiteral,
      );
    }
  });

  it("enforces business-table ownership for static SQL", () => {
    const actual = tableAccessViolations(sources);
    const unapproved = actual.filter(
      (key) => !LEGACY_TABLE_ACCESS_ALLOWLIST.has(key),
    );
    const staleAllowlistEntries = [...LEGACY_TABLE_ACCESS_ALLOWLIST].filter(
      (key) => !actual.includes(key),
    );
    expect({ unapproved, staleAllowlistEntries }).toEqual({
      unapproved: [],
      staleAllowlistEntries: [],
    });
  });
});
