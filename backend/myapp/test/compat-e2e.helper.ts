import { authCookie } from "./auth-session.helper";
import { configureSelectionQaHttp } from "../src/modules/ai-reading/selection-qa/presentation/configure-selection-qa-http";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { NextFunction, Request, Response } from "express";
import request from "supertest";
import { loadCompatExport } from "../characterization/compat-loader";

export interface ProviderOverride {
  token: unknown;
  value: unknown;
}

export async function createCompatApp(
  root: string,
  overrides: ProviderOverride[] = [],
  configure?: (app: INestApplication) => void,
): Promise<INestApplication> {
  process.env.SQLITE_PATH = resolve(root, "test.sqlite");
  process.env.DOWNLOAD_STORAGE_PATH = resolve(root, "downloads");
  process.env.READER_CONTENT_CACHE_PATH = resolve(root, "reader-content");
  process.env.JWT_SECRET = "compat-e2e-jwt-secret";
  process.env.ENCRYPTION_KEY = "c".repeat(64);
  process.env.BOOK_FILE_ACCESS_TOKEN_SECRET = "compat-e2e-file-secret";
  process.env.AI_READING_CONVERSATIONS_ENABLED = "false";

  const AppModule = loadCompatExport<any>(["src/app.module"], "AppModule");
  const AllExceptionsFilter = loadCompatExport<any>([
    "src/platform/http/all-exceptions.filter",
    "src/common/http/all-exceptions.filter",
  ], "AllExceptionsFilter");
  const SuccessResponseInterceptor = loadCompatExport<any>([
    "src/platform/http/success-response.interceptor",
    "src/common/http/success-response.interceptor",
  ], "SuccessResponseInterceptor");

  let builder = Test.createTestingModule({ imports: [AppModule] });
  for (const override of overrides) {
    builder = builder.overrideProvider(override.token).useValue(override.value);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  configureSelectionQaHttp(app);
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
  configure?.(app);
  await app.init();
  return app;
}

export async function registerUser(app: INestApplication, email: string) {
  const result = await request(app.getHttpServer())
    .post("/api/v1/auth/register")
    .set("Origin", "http://localhost:5173")
    .send({ email, password: "Password123!", confirmPassword: "Password123!" })
    .expect(201);
  return {
    user: result.body.data.user as { userId: number; email: string },
    sessionCookie: authCookie(result),
  };
}
