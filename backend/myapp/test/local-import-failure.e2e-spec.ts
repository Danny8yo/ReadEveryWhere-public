import { sessionHeaders } from "./auth-session.helper";
import { INestApplication } from "@nestjs/common";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import request from "supertest";
import { createCompatApp, registerUser } from "./compat-e2e.helper";
import { ImportBookUseCase } from "../src/modules/intelligent-library/catalog/application/use-cases/import-book.use-case";

describe("Local import real SQLite failure compensation (e2e)", () => {
  let app: INestApplication;
  let root = "";
  let databasePath = "";
  let token = "";
  let userId = 0;
  let repository: any;
  let parser: any;

  beforeAll(async () => {
    root = mkdtempSync(resolve(tmpdir(), "read-everywhere-import-failure-e2e-"));
    databasePath = resolve(root, "test.sqlite");
    app = await createCompatApp(root);
    token = (await registerUser(app, "import-failure@example.com")).sessionCookie;
    const importer = app.get(ImportBookUseCase) as any;
    repository = importer.books;
    parser = importer.inspector.parser;
    const database = openDatabase();
    userId = Number((database.prepare("SELECT id FROM users WHERE email = ?")
      .get("import-failure@example.com") as { id: number }).id);
    database.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    const database = openDatabase();
    database.exec("DROP TRIGGER IF EXISTS test_fail_current_pointer_insert");
    database.close();
  });

  afterAll(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("cleans the disk when Book insert fails after the write", async () => {
    const before = counts();
    jest.spyOn(repository, "insert").mockImplementationOnce(() => {
      throw new Error("injected create failure");
    });

    const result = await uploadOne("create-failure.pdf").expect(500);

    expect(result.body).toMatchObject({
      code: 50001,
      message: "Internal server error",
      details: { reason: "INTERNAL_ERROR" },
    });
    expect(counts()).toEqual(before);
    expect(importFiles()).not.toContain("create-failure.pdf");
  });

  it("cleans the disk when metadata parsing fails after the write", async () => {
    const before = counts();
    jest.spyOn(parser, "extract").mockImplementationOnce(() => {
      throw new Error("injected parser failure");
    });

    const result = await uploadOne("parser-failure.pdf").expect(500);

    expect(result.body).toMatchObject({
      code: 50001,
      message: "Internal server error",
      details: { reason: "INTERNAL_ERROR" },
    });
    expect(counts()).toEqual(before);
    expect(importFiles()).not.toContain("parser-failure.pdf");
  });

  it("rolls back the created book and disk file when current pointer insertion fails", async () => {
    const before = counts();
    const database = openDatabase();
    database.exec(`
      CREATE TRIGGER test_fail_current_pointer_insert
      BEFORE INSERT ON book_current_artifacts
      WHEN (SELECT file_name FROM book_artifacts WHERE artifact_id = NEW.artifact_id) = 'trigger-failure.pdf'
      BEGIN
        SELECT RAISE(ABORT, 'injected current pointer failure');
      END;
    `);
    database.close();

    const result = await uploadOne("trigger-failure.pdf").expect(500);

    expect(result.body).toMatchObject({
      code: 50001,
      message: "Internal server error",
      details: { reason: "INTERNAL_ERROR" },
    });
    expect(counts()).toEqual(before);
    expect(importFiles()).not.toContain("trigger-failure.pdf");
  });

  it("keeps the next batch item independent when current pointer insertion fails", async () => {
    const before = counts();
    const beforeArtifacts = artifactFiles().length;
    const database = openDatabase();
    database.exec(`
      CREATE TRIGGER test_fail_current_pointer_insert
      BEFORE INSERT ON book_current_artifacts
      WHEN (SELECT file_name FROM book_artifacts WHERE artifact_id = NEW.artifact_id) = 'batch-trigger-failure.pdf'
      BEGIN
        SELECT RAISE(ABORT, 'injected batch current pointer failure');
      END;
    `);
    database.close();

    const result = await request(app.getHttpServer())
      .post("/api/v1/library/books/import/batch")
      .set(sessionHeaders(token))
      .attach("files", pdfFixture("first"), "batch-trigger-failure.pdf")
      .attach("files", pdfFixture("second"), "batch-trigger-success.pdf")
      .expect(201);

    expect(result.body.data).toMatchObject({ importedCount: 1, failedCount: 1 });
    expect(result.body.data.items.map((item: any) => item.importStatus)).toEqual(["failed", "imported"]);
    expect(counts()).toEqual({ books: before.books + 1, bookFiles: before.bookFiles + 1 });
    expect(importFiles()).not.toContain("batch-trigger-failure.pdf");
    // 失败项会登记为 aborted artifact，等待 Catalog GC；成功项再增加一个 active artifact。
    expect(artifactFiles()).toHaveLength(beforeArtifacts + 2);
  });

  it("keeps the next batch item independent and cleans a parser-failed first item", async () => {
    const before = counts();
    const beforeArtifacts = artifactFiles().length;
    const originalExtract = parser.extract.bind(parser);
    jest.spyOn(parser, "extract")
      .mockImplementationOnce(() => {
        throw new Error("injected first batch parser failure");
      })
      .mockImplementation(originalExtract);

    const result = await request(app.getHttpServer())
      .post("/api/v1/library/books/import/batch")
      .set(sessionHeaders(token))
      .attach("files", pdfFixture("parser-first"), "batch-parser-failure.pdf")
      .attach("files", pdfFixture("parser-second"), "batch-parser-success.pdf")
      .expect(201);

    expect(result.body.data).toMatchObject({ importedCount: 1, failedCount: 1 });
    expect(result.body.data.items.map((item: any) => item.importStatus)).toEqual(["failed", "imported"]);
    expect(counts()).toEqual({ books: before.books + 1, bookFiles: before.bookFiles + 1 });
    expect(importFiles()).not.toContain("batch-parser-failure.pdf");
    expect(artifactFiles()).toHaveLength(beforeArtifacts + 1);
  });

  it("overwrite 后续失败不会删除既有路径", async () => {
    const directory = resolve(root, "downloads", String(userId), "imports");
    const existingPath = resolve(directory, "overwrite-risk.pdf");
    mkdirSync(directory, { recursive: true });
    writeFileSync(existingPath, "old-file-content");
    jest.spyOn(parser, "extract").mockImplementationOnce(() => {
      throw new Error("injected overwrite parser failure");
    });

    await request(app.getHttpServer())
      .post("/api/v1/library/books/import")
      .set(sessionHeaders(token))
      .field("conflictPolicy", "overwrite")
      .attach("file", pdfFixture("new-content"), "overwrite-risk.pdf")
      .expect(500);

    expect(existsSync(existingPath)).toBe(true);
    expect(readFileSync(existingPath, "utf8")).toBe("old-file-content");
  });

  function uploadOne(fileName: string) {
    return request(app.getHttpServer())
      .post("/api/v1/library/books/import")
      .set(sessionHeaders(token))
      .attach("file", pdfFixture(fileName), fileName);
  }

  function counts() {
    const database = openDatabase();
    const books = database.prepare("SELECT COUNT(*) AS count FROM books WHERE user_id = ?")
      .get(userId) as { count: number };
    const bookFiles = database.prepare(`
      SELECT COUNT(*) AS count
      FROM book_current_artifacts current
      INNER JOIN book_artifacts artifact ON artifact.artifact_id = current.artifact_id
      WHERE artifact.user_id = ?
    `)
      .get(userId) as { count: number };
    database.close();
    return { books: Number(books.count), bookFiles: Number(bookFiles.count) };
  }

  function importFiles(): string[] {
    try {
      return readdirSync(resolve(root, "downloads", String(userId), "imports")).sort();
    } catch {
      return [];
    }
  }

  function artifactFiles(): string[] {
    try {
      return readdirSync(resolve(root, "downloads", String(userId), "artifacts"))
        .filter((name) => name !== ".staging");
    } catch {
      return [];
    }
  }

  function openDatabase() {
    return new DatabaseSync(databasePath);
  }
});

function pdfFixture(label: string): Buffer {
  return Buffer.from(`%PDF-1.4\n${label}\n%%EOF`);
}
