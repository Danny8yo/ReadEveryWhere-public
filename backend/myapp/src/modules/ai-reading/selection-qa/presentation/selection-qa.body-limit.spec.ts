import { SuccessResponseInterceptor } from "../../../../platform/http/success-response.interceptor";
import { AllExceptionsFilter } from "../../../../platform/http/all-exceptions.filter";
import { Test } from "@nestjs/testing";
import {
  INestApplication,
  ValidationPipe,
  Controller,
  Post,
  Body,
} from "@nestjs/common";
import request from "supertest";
import { SelectionQaController } from "./selection-qa.controller";
import { configureSelectionQaHttp } from "./configure-selection-qa-http";
import { SelectionQaService } from "../application/selection-qa.service";

@Controller("/ordinary")
class OrdinaryController {
  @Post() echo(@Body() body: unknown) {
    return body;
  }
}

describe("selection QA real HTTP JSON body limit", () => {
  let app: INestApplication;
  const apply = jest.fn(async (_user, _id, input) => ({
    accepted: input.appendText.length,
  }));
  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [SelectionQaController, OrdinaryController],
      providers: [
        {
          provide: SelectionQaService,
          useValue: {
            apply,
            resolve: async (
              _u: number,
              _b: number,
              selection: { displayedQuote: string },
            ) => ({ accepted: selection.displayedQuote.length }),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    configureSelectionQaHttp(app);
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new SuccessResponseInterceptor());
    app.use((req: any, _res: any, next: () => void) => {
      req.user = { userId: 1 };
      next();
    });
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  afterEach(async () => {
    await app.close();
    apply.mockClear();
  });
  it("accepts the documented 50000 UTF16 Chinese appendText over HTTP", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/selection-qa/turns/turn/apply-annotation")
      .send({
        commandId: "long-chinese",
        appendText: "汉".repeat(50000),
        target: { kind: "append", annotationId: "note", expectedRevision: 1 },
      });
    expect(response.status).toBe(201);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(response.body.data.accepted).toBe(50000);
  });
  it("rejects 50001 UTF16 even when Unicode codepoint validation would pass", async () => {
    const appendText = "😀".repeat(25000) + "a";
    await request(app.getHttpServer())
      .post("/api/v1/selection-qa/turns/turn/apply-annotation")
      .send({
        commandId: "emoji",
        appendText,
        target: { kind: "append", annotationId: "note", expectedRevision: 1 },
      })
      .expect(400);
    expect(apply).not.toHaveBeenCalled();
  });
  it("accepts the exact supplementary-character UTF16 boundary", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/selection-qa/turns/turn/apply-annotation")
      .send({
        commandId: "emoji",
        appendText: "😀".repeat(25000),
        target: { kind: "append", annotationId: "note", expectedRevision: 1 },
      })
      .expect(201);
  });
  it("accepts 12000 Chinese raw selection characters", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/selection-qa/selections/resolve")
      .send({
        bookId: 1,
        selection: {
          scope: {
            bookId: 1,
            fileChecksum: "sha256:" + "a".repeat(64),
            extractorVersion: "v1",
            normalizationVersion: "v1",
            sectionIndex: 0,
            href: "chapter.xhtml",
          },
          cfi: "epubcfi(/6/2!/4/2:0)",
          displayedQuote: "汉".repeat(12000),
        },
      })
      .expect(201);
  });
  it("retains the bounded 256KiB QA transport limit", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/selection-qa/turns/turn/apply-annotation")
      .send({ appendText: "汉".repeat(90000) })
      .expect(413);
    expect(apply).not.toHaveBeenCalled();
  });
  it("preserves ordinary JSON parsing and its default 100KiB limit", async () => {
    const small = await request(app.getHttpServer())
      .post("/ordinary")
      .send({ value: "small" })
      .expect(201);
    expect(small.body.data).toEqual({ value: "small" });
    await request(app.getHttpServer())
      .post("/ordinary")
      .send({ value: "汉".repeat(50000) })
      .expect(500);
  });

  it("rejects a question beyond 4000 UTF16 despite fewer Unicode codepoints", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/selection-qa/conversations/conv/turns")
      .send({ commandId: "question", question: "😀".repeat(2000) + "a" })
      .expect(400);
  });
  it("rejects obsolete client bookHash rather than silently discarding it", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/selection-qa/turns/turn/apply-annotation")
      .send({
        commandId: "obsolete",
        appendText: "text",
        target: {
          kind: "create",
          annotationType: "highlight",
          color: "#ffffff",
          cfi: "epubcfi(/6/2!/4/2:0)",
          bookHash: "old",
        },
      })
      .expect(400);
  });
});
