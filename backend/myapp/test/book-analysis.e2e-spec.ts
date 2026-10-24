import { authCookie, sessionHeaders } from "./auth-session.helper";
import AdmZip from "adm-zip";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { NextFunction, Request, Response } from "express";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { LanguageModelGateway } from "../src/support/ai-model/application/language-model.gateway";
import type {
  ModelCompletion,
  ModelCompletionRequest,
} from "../src/support/ai-model/public";
import { BOOK_CLASSIFIER_PORT } from "../src/modules/intelligent-library/book-analysis/application/ports/book-classifier.port";
import { AllExceptionsFilter } from "../src/platform/http/all-exceptions.filter";
import { SuccessResponseInterceptor } from "../src/platform/http/success-response.interceptor";
import { SqliteService } from "../src/platform/persistence/sqlite/sqlite.service";

jest.setTimeout(60_000);

const EXPECTED_PROFILE = {
  primaryGenre: "technical",
  secondaryGenres: ["popular-science"],
  traits: ["章节化", "概念驱动"],
  confidence: 0.93,
  classificationSummary: "目录按概念递进，并包含明确的方法与实践章节。",
};

class FakeBookClassifier {
  readonly inputs: unknown[] = [];
  private readonly held = new Map<string, () => void>();
  private releaseRequested = false;

  async classify(input: unknown): Promise<unknown> {
    this.inputs.push(input);
    const serialized = JSON.stringify(input);
    if (serialized.includes("模型失败")) {
      throw Object.assign(new Error("fake classifier timeout"), {
        code: "CLASSIFICATION_TIMEOUT",
      });
    }
    if (serialized.includes("保持分析中")) {
      if (this.releaseRequested) {
        this.releaseRequested = false;
        return EXPECTED_PROFILE;
      }
      await new Promise<void>((resolve) => this.held.set("保持分析中", resolve));
    }
    return EXPECTED_PROFILE;
  }

  releaseHeld(): void {
    const release = this.held.get("保持分析中");
    if (release) release();
    else this.releaseRequested = true;
    this.held.delete("保持分析中");
  }
}

class FakeDeepSeek {
  async complete(input: ModelCompletionRequest): Promise<ModelCompletion> {
    return {
      id: "fake-completion",
      model: input.modelId,
      message: { role: "assistant", content: "OK" },
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      finishReason: "stop",
      durationMs: 1,
      attempt: 1,
    };
  }
}

describe("Book Analysis API (e2e)", () => {
  let app: INestApplication;
  let classifier: FakeBookClassifier;
  let userToken = "";
  let otherUserToken = "";
  let noKeyUserToken = "";
  let readyBookId = 0;
  let batchBookId = 0;
  let notAnalyzedBookId = 0;
  let heldBookId = 0;
  let failedBookId = 0;
  let staleBookId = 0;
  let missingFileBookId = 0;
  let otherUserBookId = 0;
  let noKeyBookId = 0;

  const runRoot = resolve(process.cwd(), "tmp", `book-analysis-${randomUUID()}`);
  const databasePath = resolve(runRoot, "book-analysis.sqlite");

  beforeAll(async () => {
    process.env.SQLITE_PATH = databasePath;
    process.env.DOWNLOAD_STORAGE_PATH = resolve(runRoot, "downloads");
    process.env.READER_CONTENT_CACHE_PATH = resolve(runRoot, "reader-content");
    process.env.JWT_SECRET = "book-analysis-e2e-secret";
    process.env.ENCRYPTION_KEY = "c".repeat(64);
    classifier = new FakeBookClassifier();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BOOK_CLASSIFIER_PORT)
      .useValue(classifier)
      .overrideProvider(LanguageModelGateway)
      .useValue(new FakeDeepSeek())
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }));
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new SuccessResponseInterceptor());
    app.use((req: Request, res: Response, next: NextFunction) => {
      req.requestId = req.header("x-request-id") || randomUUID();
      res.setHeader("x-request-id", req.requestId);
      next();
    });
    await app.init();

    userToken = await register(app, "book-analysis@example.com");
    otherUserToken = await register(app, "book-analysis-other@example.com");
    noKeyUserToken = await register(app, "book-analysis-no-key@example.com");

    await saveModelConfig(app, userToken);
    await saveModelConfig(app, otherUserToken);

    readyBookId = await importEpub(app, userToken, "高置信度技术书");
    batchBookId = await importEpub(app, userToken, "批量技术书");
    notAnalyzedBookId = await importEpub(app, userToken, "尚未分析的书");
    heldBookId = await importEpub(app, userToken, "保持分析中");
    failedBookId = await importEpub(app, userToken, "模型失败");
    staleBookId = await importEpub(app, userToken, "内容即将变化");
    otherUserBookId = await importEpub(app, otherUserToken, "其他用户的书");
    noKeyBookId = await importEpub(app, noKeyUserToken, "未配置模型的书");

    const manual = await request(app.getHttpServer())
      .post("/api/v1/library/books")
      .set(sessionHeaders(userToken))
      .send({ title: "只有元数据没有文件", authors: ["测试作者"] })
      .expect(201);
    missingFileBookId = manual.body.data.id;
  });

  afterAll(async () => {
    classifier.releaseHeld();
    await app.close();
    rmSync(runRoot, { recursive: true, force: true });
  });

  it("keeps model settings available and removes the retired autonomous-reading routes", async () => {
    await request(app.getHttpServer())
      .get("/api/v1/ai-reading/model-config")
      .set(sessionHeaders(userToken))
      .expect(200);
    for (const path of ["conversations", "budget-config", "tasks"]) {
      await request(app.getHttpServer())
        .get(`/api/v1/ai-reading/${path}`)
        .set(sessionHeaders(userToken))
        .expect(404);
    }
    await request(app.getHttpServer())
      .post("/api/v1/ai-reading/conversations")
      .set(sessionHeaders(userToken))
      .send({ bookId: readyBookId, message: "已下线的自主阅读" })
      .expect(404);
  });

  it("requires authentication and reports not_analyzed before first submission", async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/book-analysis/books/${readyBookId}`)
      .expect(401);

    const response = await getAnalysis(app, userToken, readyBookId);
    expect(response.body.data).toEqual({
      bookId: readyBookId,
      status: "not_analyzed",
      stale: false,
      candidate: null,
      errorCode: null,
    });
  });

  it("accepts one book, exposes a validated profile and skips a current ready result", async () => {
    const accepted = await request(app.getHttpServer())
      .post(`/api/v1/book-analysis/books/${readyBookId}`)
      .set(sessionHeaders(userToken))
      .send({})
      .expect(201);

    expect(accepted.body.data).toMatchObject({
      bookId: readyBookId,
      disposition: "accepted",
      status: "pending",
      taskId: expect.any(String),
      reason: null,
    });

    const ready = await waitForAnalysis(app, userToken, readyBookId, "ready");
    expect(ready.candidate).toMatchObject({
      ...EXPECTED_PROFILE,
      contentRevision: {
        fileChecksum: expect.stringMatching(/^sha256:/),
        extractorVersion: expect.any(String),
        normalizationVersion: expect.any(String),
      },
      modelId: "deepseek-v4-flash",
      strategyVersion: expect.any(String),
      analyzedAt: expect.any(String),
    });

    const skipped = await request(app.getHttpServer())
      .post(`/api/v1/book-analysis/books/${readyBookId}`)
      .set(sessionHeaders(userToken))
      .send({})
      .expect(201);
    expect(skipped.body.data).toMatchObject({
      bookId: readyBookId,
      disposition: "skipped",
      status: "ready",
      taskId: null,
    });

    const forced = await request(app.getHttpServer())
      .post(`/api/v1/book-analysis/books/${readyBookId}`)
      .set(sessionHeaders(userToken))
      .send({ force: true })
      .expect(201);
    expect(forced.body.data).toMatchObject({
      bookId: readyBookId,
      disposition: "accepted",
      status: "pending",
      taskId: expect.any(String),
    });
    await waitForAnalysis(app, userToken, readyBookId, "ready");
  });

  it("deduplicates batch ids and returns per-book accepted or rejected outcomes", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/book-analysis/batch")
      .set(sessionHeaders(userToken))
      .send({
        bookIds: [batchBookId, batchBookId, missingFileBookId, otherUserBookId],
      })
      .expect(201);

    expect(response.body.data.items).toHaveLength(3);
    expect(response.body.data.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        bookId: batchBookId,
        disposition: "accepted",
        status: "pending",
        taskId: expect.any(String),
        reason: null,
      }),
      expect.objectContaining({
        bookId: missingFileBookId,
        disposition: "rejected",
        reason: "BOOK_FILE_MISSING",
      }),
      expect.objectContaining({
        bookId: otherUserBookId,
        disposition: "rejected",
        reason: "BOOK_NOT_FOUND",
      }),
    ]));

    const noKey = await request(app.getHttpServer())
      .post("/api/v1/book-analysis/batch")
      .set(sessionHeaders(noKeyUserToken))
      .send({ bookIds: [noKeyBookId] })
      .expect(201);
    expect(noKey.body.data.items).toEqual([
      expect.objectContaining({
        bookId: noKeyBookId,
        disposition: "rejected",
        reason: "AI_MODEL_NOT_CONFIGURED",
      }),
    ]);

    await request(app.getHttpServer())
      .post("/api/v1/book-analysis/batch")
      .set(sessionHeaders(userToken))
      .send({ bookIds: Array.from({ length: 51 }, (_, index) => index + 1) })
      .expect(400);
  });

  it("adds the nested analysis summary to library list and detail without changing metadata", async () => {
    const list = await request(app.getHttpServer())
      .get("/api/v1/library/books?page=1&pageSize=50")
      .set(sessionHeaders(userToken))
      .expect(200);
    const listed = list.body.data.items.find((book: { id: number }) => book.id === readyBookId);
    expect(listed).toMatchObject({
      id: readyBookId,
      title: "高置信度技术书",
      authors: ["测试作者"],
      bookAnalysis: {
        status: "ready",
        primaryGenre: "technical",
        displayLabel: expect.any(String),
        confidence: 0.93,
        analyzedAt: expect.any(String),
        stale: false,
      },
    });

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/library/books/${readyBookId}`)
      .set(sessionHeaders(userToken))
      .expect(200);
    expect(detail.body.data).toMatchObject({
      id: readyBookId,
      title: "高置信度技术书",
      bookAnalysis: listed.bookAnalysis,
    });

    const unanalysed = list.body.data.items.find((book: { id: number }) => book.id === notAnalyzedBookId);
    expect(unanalysed.bookAnalysis).toBeNull();
  });

  it.each([
    ["not_analyzed", () => notAnalyzedBookId],
    ["pending", () => heldBookId],
    ["failed", () => failedBookId],
    ["stale", () => staleBookId],
  ] as const)("reports analysis state %s", async (state, bookId) => {
    const id = bookId();
    if (state === "pending") {
      await request(app.getHttpServer())
        .post(`/api/v1/book-analysis/books/${id}`)
        .set(sessionHeaders(userToken))
        .send({})
        .expect(201);
    } else if (state === "failed") {
      await request(app.getHttpServer())
        .post(`/api/v1/book-analysis/books/${id}`)
        .set(sessionHeaders(userToken))
        .send({})
        .expect(201);
      await waitForAnalysis(app, userToken, id, "failed");
    } else if (state === "stale") {
      await request(app.getHttpServer())
        .post(`/api/v1/book-analysis/books/${id}`)
        .set(sessionHeaders(userToken))
        .send({})
        .expect(201);
      await waitForAnalysis(app, userToken, id, "ready");
      replaceStoredEpub(app, id, createEpub("内容已经变化", "新的正文触发 revision 变化。"));
      const stale = await waitForAnalysis(app, userToken, id, "stale");
      expect(stale.stale).toBe(true);
    }

    const response = await getAnalysis(app, userToken, id);
    expect(response.body.data.status).toBe(state);

    if (state === "pending") {
      classifier.releaseHeld();
      await waitForAnalysis(app, userToken, id, "ready");
    }
  });

  it("applies a ready candidate to the formal reading profile only after explicit confirmation", async () => {
    const candidate = await waitForAnalysis(app, userToken, readyBookId, "ready");
    const candidateProfile = candidate.candidate as { id?: unknown } | null;
    expect(candidateProfile?.id).toEqual(expect.any(String));
    const candidateId = String(candidateProfile?.id);
    await request(app.getHttpServer())
      .post(`/api/v1/book-analysis/books/${readyBookId}/apply`)
      .set(sessionHeaders(userToken))
      .send({ candidateId, override: false })
      .expect(201);

    const applied = await waitForAnalysis(app, userToken, readyBookId, "ready");
    expect(applied.candidate).toMatchObject({
      id: candidateId,
      status: "applied",
    });
    const library = await request(app.getHttpServer())
      .get(`/api/v1/library/books/${readyBookId}`)
      .set(sessionHeaders(userToken))
      .expect(200);
    expect(library.body.data.bookAnalysis).toMatchObject({
      status: "ready",
      candidateId: null,
    });
  });
});

async function register(app: INestApplication, email: string): Promise<string> {
  const response = await request(app.getHttpServer())
    .post("/api/v1/auth/register")
    .set("Origin", "http://localhost:5173")
    .send({ email, password: "Password123!", confirmPassword: "Password123!" })
    .expect(201);
  return authCookie(response) as string;
}

async function saveModelConfig(app: INestApplication, token: string): Promise<void> {
  await request(app.getHttpServer())
    .put("/api/v1/ai-reading/model-config")
    .set(sessionHeaders(token))
    .send({ apiKey: "sk-fake-book-analysis", modelId: "deepseek-v4-flash" })
    .expect(200);
}

async function importEpub(app: INestApplication, token: string, title: string): Promise<number> {
  const response = await request(app.getHttpServer())
    .post("/api/v1/library/books/import")
    .set(sessionHeaders(token))
    .attach("file", createEpub(title), {
      filename: `${title}.epub`,
      contentType: "application/epub+zip",
    })
    .expect(201);
  return response.body.data.book.id as number;
}

function createEpub(title: string, body = "概念、原理、方法、示例与实践构成了本书的主要内容。") {
  const zip = new AdmZip();
  zip.addFile("mimetype", Buffer.from("application/epub+zip"));
  zip.addFile("META-INF/container.xml", Buffer.from(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`));
  zip.addFile("OEBPS/content.opf", Buffer.from(`<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>${title}</dc:title><dc:creator>测试作者</dc:creator><dc:description>结构化技术读物</dc:description>
</metadata><manifest>
  <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
</manifest><spine><itemref idref="chapter"/></spine></package>`));
  zip.addFile("OEBPS/nav.xhtml", Buffer.from(`<!doctype html><html xmlns:epub="http://www.idpf.org/2007/ops"><body>
<nav epub:type="toc"><ol><li><a href="chapter.xhtml">第一章 方法</a></li></ol></nav></body></html>`));
  zip.addFile("OEBPS/chapter.xhtml", Buffer.from(`<!doctype html><html><body><h1>第一章 方法</h1><p>${body}</p></body></html>`));
  return zip.toBuffer();
}

async function getAnalysis(app: INestApplication, token: string, bookId: number) {
  return request(app.getHttpServer())
    .get(`/api/v1/book-analysis/books/${bookId}`)
    .set(sessionHeaders(token))
    .expect(200);
}

async function waitForAnalysis(
  app: INestApplication,
  token: string,
  bookId: number,
  expectedStatus: string,
) {
  const deadline = Date.now() + 15_000;
  let last: Record<string, unknown> | null = null;
  while (Date.now() < deadline) {
    const response = await getAnalysis(app, token, bookId);
    last = response.body.data as Record<string, unknown>;
    if (last.status === expectedStatus) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`analysis ${bookId} did not reach ${expectedStatus}: ${JSON.stringify(last)}`);
}

function replaceStoredEpub(app: INestApplication, bookId: number, replacement: Buffer): void {
  const database = app.get(SqliteService).getDatabase();
  const row = database.prepare(`
    SELECT artifact.stored_path
    FROM book_current_artifacts current
    INNER JOIN book_artifacts artifact ON artifact.artifact_id = current.artifact_id
    WHERE current.book_id = ? AND artifact.status = 'active'
  `).get(bookId) as unknown as { stored_path: string | null };
  const configuredRoot = resolve(process.cwd(), process.env.DOWNLOAD_STORAGE_PATH ?? "data/downloads");
  if (!row.stored_path) throw new Error(`Book ${bookId} has no current artifact path`);
  const storedPath = resolve(configuredRoot, row.stored_path);
  expect(readFileSync(storedPath).length).toBeGreaterThan(0);
  writeFileSync(storedPath, replacement);
}
