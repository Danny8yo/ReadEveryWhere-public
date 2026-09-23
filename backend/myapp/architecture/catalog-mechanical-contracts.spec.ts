import "reflect-metadata";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import ts from "typescript";
import { CreateDownloadTaskDto } from "../src/modules/acquisition/download/presentation/http/dto/create-download-task.dto";
import { CatalogError } from "../src/modules/intelligent-library/catalog/domain/catalog.error";
import { ApplyMetadataDto } from "../src/modules/intelligent-library/metadata-enrichment/presentation/dto/apply-metadata.dto";
import { AddFromSearchDto } from "../src/modules/intelligent-library/library-queries/presentation/http/dto/add-from-search.dto";
import { BatchDeleteBooksDto } from "../src/modules/intelligent-library/library-queries/presentation/http/dto/batch-delete-books.dto";
import { CreateBookDto } from "../src/modules/intelligent-library/library-queries/presentation/http/dto/create-book.dto";
import { ImportBookDto } from "../src/modules/intelligent-library/library-queries/presentation/http/dto/import-book.dto";
import { ListLibraryBooksDto } from "../src/modules/intelligent-library/library-queries/presentation/http/dto/list-library-books.dto";
import { UpdateBookDto } from "../src/modules/intelligent-library/library-queries/presentation/http/dto/update-book.dto";
import { toCatalogHttpError } from "../src/modules/intelligent-library/library-queries/presentation/http/catalog-error.mapper";

const controllerContracts = [
  {
    file: "src/modules/intelligent-library/library-queries/presentation/http/library.controller.ts",
    prefix: "api/v1/library/books",
    routes: [
      "GET <root> -> listBooks",
      "GET import-capabilities -> getImportCapabilities",
      "GET :id -> getBook",
      "GET :id/reading-profile -> getReadingProfile",
      "PATCH :id/reading-profile -> editReadingProfile",
      "DELETE :id/reading-profile -> clearReadingProfile",
      "POST import -> importBook",
      "POST import/batch -> importBooksBatch",
      "POST <root> -> createBook",
      "POST from-search -> addFromSearch",
      "PATCH :id -> updateBook",
      "DELETE :id -> deleteBook",
      "POST batch-delete -> batchDeleteBooks",
      "POST :id/file-access -> createBookFileAccess",
      "GET :id/file -> streamBookFileWithToken",
      "GET :id/stream -> streamBookFile",
    ],
  },
  {
    file: "src/modules/intelligent-library/metadata-enrichment/presentation/metadata.controller.ts",
    prefix: "api/v1/metadata",
    routes: [
      "POST scrape -> scrape",
      "GET douban-rating -> doubanRating",
      "PATCH books/:id -> apply",
    ],
  },
  {
    file: "src/modules/acquisition/download/presentation/http/download.controller.ts",
    prefix: "api/v1/downloads",
    routes: [
      "POST tasks -> createTask",
      "GET tasks/:taskId -> getTask",
      "DELETE tasks/:taskId -> cancelTask",
    ],
  },
] as const;

const dtoContracts: Record<string, Record<string, string[]>> = {
  CreateBookDto: {
    title: ["Transform(trim-string)", "IsString", "MaxLength(200)"],
    authors: ["IsArray", "ArrayMinSize(1)", "ArrayMaxSize(20)", "IsString({ each: true })", "MaxLength(300, { each: true })"],
    sourcePlatform: ["IsOptional", "Transform(trim-string)", "IsString", "MaxLength(50)"],
    sourceBookId: ["IsOptional", "Transform(trim-string)", "IsString", "MaxLength(200)"],
    sourceUrl: ["IsOptional", "Transform(trim-string)", "IsString", "MaxLength(2000)"],
    coverUrl: ["IsOptional", "Transform(trim-string)", "IsString", "MaxLength(2000)"],
    description: ["IsOptional", "Transform(trim-string)", "IsString", "MaxLength(5000)"],
    publisher: ["IsOptional", "Transform(trim-string)", "IsString", "MaxLength(300)"],
    isbn: ["IsOptional", "Transform(trim-string)", "IsString", "MaxLength(50)"],
    language: ["IsOptional", "Transform(trim-string)", "IsString", "MaxLength(100)"],
    publishYear: ["IsOptional", "Type(Number)", "IsInt", "Min(0)", "Max(9999)"],
    editionTag: ["IsOptional", "Transform(trim-string)", "IsString", "MaxLength(200)"],
    hash: ["IsOptional", "Transform(trim-string)", "IsString", "MaxLength(100)"],
  },
  AddFromSearchDto: {
    sourcePlatform: ["IsNotEmpty"],
    sourceBookId: ["IsNotEmpty"],
    format: ["IsIn(EBOOK_FORMATS)"],
  },
  UpdateBookDto: {
    title: ["IsOptional", "Transform(trim-string)", "IsString", "MaxLength(200)"],
    authors: ["IsOptional", "IsArray", "ArrayMinSize(0)", "ArrayMaxSize(20)", "IsString({ each: true })", "MaxLength(300, { each: true })"],
    isbn: ["IsOptional", "Transform(trim-string)", "IsString", "MaxLength(20)"],
    language: ["IsOptional", "Transform(trim-string)", "IsString", "MaxLength(100)"],
    coverUrl: ["IsOptional", "Transform(trim-string)", "IsString", "MaxLength(2000)"],
    description: ["IsOptional", "Transform(trim-string)", "IsString", "MaxLength(5000)"],
    publishYear: ["IsOptional", "Type(Number)", "IsInt", "Min(0)", "Max(9999)"],
    publisher: ["IsOptional", "Transform(trim-string)", "IsString", "MaxLength(300)"],
    editionTag: ["IsOptional", "Transform(trim-string)", "IsString", "MaxLength(200)"],
  },
  ImportBookDto: {
    title: ["IsOptional", "IsString"],
    authors: ["IsOptional", "IsString"],
    isbn: ["IsOptional", "IsString"],
    coverUrl: ["IsOptional", "IsString"],
    conflictPolicy: ["IsOptional", 'IsIn(["overwrite", "skip", "rename"])'],
  },
  ListLibraryBooksDto: {
    page: ["IsOptional", "Type(Number)", "IsInt", "Min(1)", "Max(10000)"],
    pageSize: ["IsOptional", "Type(Number)", "IsInt", "Min(1)", "Max(50)"],
    keyword: ["IsOptional", "Transform(trim-string)", "IsString", "MaxLength(200)"],
    primaryGenre: ["IsOptional", "IsIn(BOOK_READING_GENRES)"],
    secondaryGenre: ["IsOptional", "IsIn(BOOK_READING_GENRES)"],
    formats: ["IsOptional", "Transform(({ value }) => Array.isArray(value) ? value : [value])", "IsArray", "ArrayUnique", "ArrayMaxSize(EBOOK_FORMATS.length)", "IsIn(EBOOK_FORMATS, { each: true })"],
  },
  BatchDeleteBooksDto: {
    ids: ["IsArray", "ArrayMinSize(1)", "ArrayMaxSize(500)", "Type(Number)", "IsInt({ each: true })", "Min(1, { each: true })"],
  },
  ApplyMetadataDto: {
    expectedVersion: ["Type(Number)", "IsInt", "Min(1)"],
    title: ["IsOptional", "Transform(trim-string)", "IsString", "MaxLength(200)"],
    authors: ["IsOptional", "IsArray", "ArrayMaxSize(20)", "IsString({ each: true })", "MaxLength(300, { each: true })"],
    isbn: ["IsOptional", "Transform(trim-string)", "IsString", "MaxLength(20)"],
    language: ["IsOptional", "Transform(trim-string)", "IsString", "MaxLength(100)"],
    coverUrl: ["IsOptional", "Transform(trim-string)", "IsString", "MaxLength(2000)"],
    description: ["IsOptional", "Transform(trim-string)", "IsString", "MaxLength(5000)"],
    publishYear: ["IsOptional", "Type(Number)", "IsInt", "Min(0)", "Max(9999)"],
    publisher: ["IsOptional", "Transform(trim-string)", "IsString", "MaxLength(300)"],
    editionTag: ["IsOptional", "Transform(trim-string)", "IsString", "MaxLength(200)"],
    sourcePlatform: ["IsOptional", "Transform(trim-string)", "IsString", "MaxLength(100)"],
    sourceBookId: ["IsOptional", "Transform(trim-string)", "IsString", "MaxLength(200)"],
    sourceUrl: ["IsOptional", "Transform(trim-string)", "IsString", "MaxLength(2000)"],
  },
  CreateDownloadTaskDto: {
    bookId: ["Type(Number)", "IsInt", "Min(1)"],
    sourcePlatform: ["Transform(trim-string)", "IsString", 'IsIn(["zlibrary"])'],
    sourceUrl: ["Transform(trim-string)", "IsString", "MaxLength(2000)"],
    fileName: ["IsOptional", "Transform(trim-string)", "IsString", "MaxLength(255)"],
  },
};

const dtoFiles = [
  "src/modules/intelligent-library/library-queries/presentation/http/dto/create-book.dto.ts",
  "src/modules/intelligent-library/library-queries/presentation/http/dto/add-from-search.dto.ts",
  "src/modules/intelligent-library/library-queries/presentation/http/dto/update-book.dto.ts",
  "src/modules/intelligent-library/library-queries/presentation/http/dto/import-book.dto.ts",
  "src/modules/intelligent-library/library-queries/presentation/http/dto/list-library-books.dto.ts",
  "src/modules/intelligent-library/library-queries/presentation/http/dto/batch-delete-books.dto.ts",
  "src/modules/intelligent-library/metadata-enrichment/presentation/dto/apply-metadata.dto.ts",
  "src/modules/acquisition/download/presentation/http/dto/create-download-task.dto.ts",
];

describe("catalog HTTP and persistence mechanical contracts", () => {
  it.each(controllerContracts)("freezes $prefix controller methods and paths", ({ file, prefix, routes }) => {
    expect(controllerContract(file)).toEqual({ prefix, routes: [...routes] });
  });

  it("freezes DTO fields and validator/transform decorators", () => {
    const actual = Object.assign({}, ...dtoFiles.map(dtoContract));
    expect(actual).toEqual(dtoContracts);
  });

  it("keeps DTO transforms and validation behavior stable", () => {
    const create = plainToInstance(CreateBookDto, {
      title: "  Book  ", authors: ["Author"], sourcePlatform: " ZLibrary ",
      sourceBookId: " id ", publishYear: "2026", hash: " hash ",
    });
    expect(create).toMatchObject({
      title: "Book", sourcePlatform: "ZLibrary", sourceBookId: "id", publishYear: 2026, hash: "hash",
    });
    expect(validateSync(create)).toHaveLength(0);

    const list = plainToInstance(ListLibraryBooksDto, { page: "2", pageSize: "50", keyword: "  term  " });
    expect(list).toMatchObject({ page: 2, pageSize: 50, keyword: "term" });
    expect(validateSync(list)).toHaveLength(0);

    const metadata = plainToInstance(ApplyMetadataDto, {
      expectedVersion: "3", title: " T ", publishYear: "2025", sourceUrl: " U ",
    });
    expect(metadata).toMatchObject({ expectedVersion: 3, title: "T", publishYear: 2025, sourceUrl: "U" });
    expect(validateSync(metadata)).toHaveLength(0);

    const download = plainToInstance(CreateDownloadTaskDto, {
      bookId: "4", sourcePlatform: " zlibrary ", sourceUrl: " https://example.test/file ",
    });
    expect(download).toMatchObject({ bookId: 4, sourcePlatform: "zlibrary", sourceUrl: "https://example.test/file" });
    expect(validateSync(download)).toHaveLength(0);

    expect(validateSync(plainToInstance(AddFromSearchDto, {
      title: "Book", authors: ["Author"], sourcePlatform: "", sourceBookId: "", format: "epub",
    })).map((error) => error.property)).toEqual(["sourcePlatform", "sourceBookId"]);
    expect(validateSync(plainToInstance(BatchDeleteBooksDto, { ids: [0] }))[0]?.property).toBe("ids");
    expect(validateSync(plainToInstance(ImportBookDto, { conflictPolicy: "merge" }))[0]?.property)
      .toBe("conflictPolicy");
    expect(validateSync(plainToInstance(UpdateBookDto, { publishYear: 10000 }))[0]?.property)
      .toBe("publishYear");
  });

  it("freezes final books, source_refs, and current artifact pointer DDL", () => {
    const sqlite = source("src/platform/persistence/sqlite/schema-current.ts");
    expect(tableDefinition(sqlite, "books")).toBe(normalizeSql(`
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, title TEXT NOT NULL,
      title_normalized TEXT NOT NULL, authors_json TEXT NOT NULL, authors_text TEXT NOT NULL,
      isbn TEXT, language TEXT, cover_url TEXT, description TEXT, publisher TEXT,
      publish_year INTEGER, edition_tag TEXT,
      version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(id, user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    `));
    expect(tableDefinition(sqlite, "source_refs")).toBe(normalizeSql(`
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, book_id INTEGER NOT NULL,
      source_platform TEXT NOT NULL, source_book_id TEXT, source_url TEXT,
      format TEXT CHECK (format IS NULL OR format IN ('pdf', 'epub', 'mobi', 'azw3')),
      is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)), hash TEXT,
      availability TEXT NOT NULL DEFAULT 'available', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (book_id, user_id) REFERENCES books(id, user_id) ON DELETE CASCADE
    `));
    expect(tableDefinition(sqlite, "book_current_artifacts")).toBe(normalizeSql(`
      book_id INTEGER PRIMARY KEY, artifact_id TEXT NOT NULL UNIQUE, activated_at TEXT NOT NULL,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
      FOREIGN KEY (artifact_id) REFERENCES book_artifacts(artifact_id) ON DELETE RESTRICT
    `));

    for (const contract of [
      "CREATE INDEX IF NOT EXISTS idx_books_user_updated_at ON books(user_id, updated_at DESC)",
      "CREATE INDEX IF NOT EXISTS idx_books_user_title_norm ON books(user_id, title_normalized)",
      "CREATE INDEX IF NOT EXISTS idx_books_user_isbn ON books(user_id, isbn)",
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_source_refs_user_platform_bookid ON source_refs(user_id, source_platform, source_book_id) WHERE source_book_id IS NOT NULL",
      "CREATE INDEX IF NOT EXISTS idx_source_refs_book_id ON source_refs(book_id)",
      "CREATE INDEX IF NOT EXISTS idx_source_refs_user_platform ON source_refs(user_id, source_platform)",
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_source_refs_primary_book ON source_refs(book_id) WHERE is_primary = 1",
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_book_artifacts_active_book ON book_artifacts(user_id, book_id) WHERE status = 'active'",
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_book_artifacts_active_checksum ON book_artifacts(user_id, checksum) WHERE status = 'active' AND checksum IS NOT NULL",
    ]) {
      expect(normalizeSql(sqlite)).toContain(normalizeSql(contract));
    }
  });

  it("freezes core CatalogError to HTTP mappings", () => {
    expect([
      CatalogError.validation("title", "bad"),
      CatalogError.conflict("sourceBookId", "duplicate"),
      CatalogError.conflict("sourceBookId", "duplicate", 41),
      CatalogError.notFound("book", "missing"),
      CatalogError.unauthorized("nope"),
      CatalogError.internal("broken"),
    ].map((error) => {
      const mapped = toCatalogHttpError(error);
      return { status: mapped.status, code: mapped.code, message: mapped.message, details: mapped.details };
    })).toEqual([
      { status: 400, code: 40002, message: "bad", details: { field: "title", reason: "VALIDATION_ERROR" } },
      { status: 409, code: 40003, message: "duplicate", details: { field: "sourceBookId", reason: "RESOURCE_CONFLICT" } },
      { status: 409, code: 40003, message: "duplicate", details: { field: "sourceBookId", reason: "RESOURCE_CONFLICT", existingBookId: 41 } },
      { status: 404, code: 40401, message: "missing", details: { field: "book", reason: "RESOURCE_NOT_FOUND" } },
      { status: 401, code: 40101, message: "nope", details: { reason: "UNAUTHORIZED" } },
      { status: 500, code: 50001, message: "broken", details: { reason: "INTERNAL_ERROR" } },
    ]);
  });
});

function controllerContract(relativePath: string): { prefix: string; routes: string[] } {
  const ast = sourceFile(relativePath);
  const controller = ast.statements.find(ts.isClassDeclaration);
  if (!controller) throw new Error(`Controller class missing in ${relativePath}`);
  const prefix = decoratorStringArgument(controller, "Controller") ?? "";
  const routes = controller.members.flatMap((member) => {
    if (!ts.isMethodDeclaration(member) || !member.name) return [];
    for (const method of ["Get", "Post", "Patch", "Delete"]) {
      const path = decoratorStringArgument(member, method);
      if (path !== null) return [`${method.toUpperCase()} ${path || "<root>"} -> ${member.name.getText(ast)}`];
    }
    return [];
  });
  return { prefix, routes };
}

function dtoContract(relativePath: string): Record<string, Record<string, string[]>> {
  const ast = sourceFile(relativePath);
  const classes: Record<string, Record<string, string[]>> = {};
  for (const statement of ast.statements) {
    if (!ts.isClassDeclaration(statement) || !statement.name) continue;
    classes[statement.name.text] = Object.fromEntries(statement.members.flatMap((member) => {
      if (!ts.isPropertyDeclaration(member) || !member.name) return [];
      return [[member.name.getText(ast), decorators(member).map((decorator) => decoratorContract(decorator, ast))]];
    }));
  }
  return classes;
}

function decoratorContract(decorator: ts.Decorator, ast: ts.SourceFile): string {
  if (!ts.isCallExpression(decorator.expression)) return decorator.expression.getText(ast);
  const name = decorator.expression.expression.getText(ast);
  if (name === "Transform") {
    const body = decorator.expression.arguments[0]?.getText(ast).replace(/\s+/g, " ");
    return body === '({ value }) => (typeof value === "string" ? value.trim() : value)'
      ? "Transform(trim-string)"
      : `Transform(${body ?? ""})`;
  }
  if (name === "Type") {
    const body = decorator.expression.arguments[0]?.getText(ast).replace(/\s+/g, " ");
    return body === "() => Number" ? "Type(Number)" : `Type(${body ?? ""})`;
  }
  if (decorator.expression.arguments.length === 0) return name;
  return decorator.expression.getText(ast).replace(/\s+/g, " ");
}

function decoratorStringArgument(node: ts.Node, name: string): string | null {
  const decorator = decorators(node).find((candidate) =>
    ts.isCallExpression(candidate.expression)
    && candidate.expression.expression.getText() === name);
  if (!decorator || !ts.isCallExpression(decorator.expression)) return null;
  const argument = decorator.expression.arguments[0];
  return argument && ts.isStringLiteral(argument) ? argument.text : "";
}

function decorators(node: ts.Node): readonly ts.Decorator[] {
  return ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [];
}

function tableDefinition(sqliteSource: string, table: string): string {
  const match = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\s*\\);`).exec(sqliteSource);
  if (!match) throw new Error(`DDL missing for ${table}`);
  return normalizeSql(match[1]);
}

function normalizeSql(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/;$/, "");
}

function sourceFile(relativePath: string): ts.SourceFile {
  const path = resolve(process.cwd(), relativePath);
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}
