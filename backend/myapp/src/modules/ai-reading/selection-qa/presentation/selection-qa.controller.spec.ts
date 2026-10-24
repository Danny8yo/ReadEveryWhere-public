import { QA_POLICY } from "../application/selection-qa-runtime.port";
const admission = {
  snapshot: () => ({
    version: 1 as const,
    providerId: "test",
    modelId: "test",
    configUpdatedAt: null,
    tokenizerId: "test",
    contextWindowTokens: 64000,
    maxOutputTokens: 4096,
    policyVersion: QA_POLICY.version,
  }),
};
import { Test } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { DatabaseSync } from "node:sqlite";
import request from "supertest";
import { SelectionQaController } from "./selection-qa.controller";
import { SelectionQaService } from "../application/selection-qa.service";
import { SelectionQaBookSelectionAdapter } from "../infrastructure/book-selection.adapter";
import { SqliteSelectionQaRepository } from "../infrastructure/sqlite-selection-qa.repository";
import { SqliteService } from "../../../../platform/persistence/sqlite/sqlite.service";
import { initializeSchema } from "../../../../platform/persistence/sqlite/schema-migrations";
import { seedUpgradeFixture } from "../../../../platform/persistence/sqlite/schema-upgrade.fixture";
import { AllExceptionsFilter } from "../../../../platform/http/all-exceptions.filter";
import { ReaderToolException } from "../../../intelligent-library/public";
import { SelectionSnapshot } from "../application/selection-qa.types";
const selection = {
  scope: {
    bookId: 1,
    fileChecksum: "checksum",
    extractorVersion: "v1",
    normalizationVersion: "v1",
    sectionIndex: 0,
    href: "chapter.xhtml",
  },
  source: { start: { path: [0], offset: 0 }, end: { path: [0], offset: 4 } },
  displayedQuote: "text",
};
const verified = {
  ...selection,
  artifact: { bookId: 1, artifactId: "artifact", fileChecksum: "checksum" },
  canonicalQuote: "text",
  start: 0,
  end: 4,
} as SelectionSnapshot;
describe("selection QA HTTP", () => {
  let app: INestApplication, db: DatabaseSync, service: SelectionQaService;
  beforeEach(async () => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys=ON");
    initializeSchema(db);
    seedUpgradeFixture(db);
    service = new SelectionQaService(
      new SqliteSelectionQaRepository({
        getDatabase: () => db,
      } as SqliteService),
      new SelectionQaBookSelectionAdapter({
        resolveSelection: async (user) => {
          if (user !== 1)
            throw new ReaderToolException("BOOK_NOT_FOUND", "missing");
          return verified;
        },
        assertCurrent: () => {},
      }),
      {
        findReceipt: () => null,
        execute: async () => {
          throw new Error("unused");
        },
      },
      admission,
    );
    const module = await Test.createTestingModule({
      controllers: [SelectionQaController],
      providers: [{ provide: SelectionQaService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    app.use((req: any, _res: any, next: () => void) => {
      req.user = { userId: Number(req.headers["x-test-user"] ?? 1) };
      next();
    });
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, "127.0.0.1");
  });
  afterEach(async () => {
    await app.close();
    db.close();
  });
  it("rejects malformed nested selection, blank question, and missing target", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/selection-qa/selections/resolve")
      .send({ bookId: 1, selection: { scope: {} } })
      .expect(400);
    await request(app.getHttpServer())
      .post("/api/v1/selection-qa/conversations").set("X-Selection-QA-Protocol", "2")
      .send({ bookId: 1, selection, commandId: "a", question: "  " })
      .expect(400);
    await request(app.getHttpServer())
      .post("/api/v1/selection-qa/turns/missing/apply-annotation")
      .send({ commandId: "a", appendText: "x" })
      .expect(400);
  });
  it("maps ownership error and rejects cross-user conversation reads", async () => {
    const failed = await request(app.getHttpServer())
      .post("/api/v1/selection-qa/selections/resolve")
      .set("x-test-user", "2")
      .send({ bookId: 1, selection })
      .expect(404);
    expect(failed.body.details.reason).toBe("BOOK_NOT_FOUND");
    const created = await request(app.getHttpServer())
      .post("/api/v1/selection-qa/conversations").set("X-Selection-QA-Protocol", "2")
      .send({ bookId: 1, selection, commandId: "a", question: "q" })
      .expect(201);
    await request(app.getHttpServer())
      .get(`/api/v1/selection-qa/conversations/${created.body.conversation.id}`)
      .set("x-test-user", "2")
      .expect(404);
  });
  it("keeps SSE alive after request completion and streams persisted terminal event", async () => {
    const created = (await service.create(1, {
      bookId: 1,
      selection,
      commandId: "a",
      question: "q",
    })) as { turn: { id: string } };
    const url = await app.getUrl();
    const response = await fetch(
      `${url}/api/v1/selection-qa/turns/${created.turn.id}/events`,
      { headers: { "X-Selection-QA-Protocol": "2" } },
    );
    const reader = response.body!.getReader();
    const initial = await reader.read();
    expect(new TextDecoder().decode(initial.value)).toContain("event: status");
    service.stop(1, created.turn.id);
    let text = "";
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      text += new TextDecoder().decode(item.value);
    }
    expect(text).toContain("event: terminal");
    expect(text).toContain("USER_STOPPED");
  });
  it("disconnecting SSE does not stop the queued task", async () => {
    const created = (await service.create(1, {
      bookId: 1,
      selection,
      commandId: "a",
      question: "q",
    })) as { turn: { id: string } };
    const response = await fetch(
      `${await app.getUrl()}/api/v1/selection-qa/turns/${created.turn.id}/events`,
      { headers: { "X-Selection-QA-Protocol": "2" } },
    );
    await response.body!.cancel();
    expect(service.getTurn(1, created.turn.id).status).toBe("queued");
  });
});
