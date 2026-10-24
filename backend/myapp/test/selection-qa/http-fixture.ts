import { sessionHeaders } from "../auth-session.helper";
import { SqliteService } from "../../src/platform/persistence/sqlite/sqlite.service";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { randomUUID } from "node:crypto";
import {
  createCompatApp,
  registerUser,
  type ProviderOverride,
} from "../compat-e2e.helper";
import { selfAuthoredEpub, selectionRequest } from "./self-authored-epub";
import type { Turn } from "../../src/modules/ai-reading/selection-qa/application/selection-qa.types";
export async function createSelectionQaFixture(
  root: string,
  overrides: ProviderOverride[] = [],
  configure?: (app: INestApplication) => void,
) {
  const app = await createCompatApp(root, overrides, configure);
  const auth = await registerUser(app, `qa-${randomUUID()}@example.test`);
  const other = await registerUser(
    app,
    `qa-other-${randomUUID()}@example.test`,
  );
  const epub = selfAuthoredEpub();
  const imported = await request(app.getHttpServer())
    .post("/api/v1/library/books/import")
    .set(sessionHeaders(auth.sessionCookie))
    .attach("file", epub.bytes, {
      filename: "selection-qa.epub",
      contentType: "application/epub+zip",
    })
    .expect(201);
  const bookId = imported.body.data.book.id as number;
  const selection = selectionRequest(bookId, epub.checksum);
  return { app, auth, other, bookId, epub, selection };
}
export function qaRequest(
  app: INestApplication,
  token: string,
  method: "get" | "post" | "delete",
  path: string,
) {
  return request(app.getHttpServer())
    [method]("/api/v1/selection-qa" + path)
    .set(sessionHeaders(token)).set("X-Selection-QA-Protocol", "2");
}
export const terminalMetrics = new Map<string, Record<string, unknown>>();
export async function waitForTurn(
  app: INestApplication,
  token: string,
  conversationId: string,
  turnId: string,
  timeoutMs = 10000,
): Promise<Turn> {
  const deadline = Date.now() + timeoutMs;
  let last: Turn | undefined;
  while (Date.now() < deadline) {
    const response = await qaRequest(
      app,
      token,
      "get",
      `/conversations/${conversationId}/turns`,
    ).expect(200);
    last = (response.body.data.items as Turn[]).find((t) => t.id === turnId);
    if (last && !["queued", "running"].includes(last.status)) {
      const db = app.get(SqliteService).getDatabase();
      const delta = db
        .prepare(
          "SELECT MIN(created_at) time FROM selection_qa_events WHERE turn_id=? AND kind='answer_delta'",
        )
        .get(turnId)!;
      terminalMetrics.set(turnId, {
        turnId,
        status: last.status,
        errorCode: last.errorCode,
        firstDeltaMs:
          delta.time === null ? null : Number(delta.time) - last.createdAt,
        totalMs: last.updatedAt - last.createdAt,
      });
      return last;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Turn did not finish: ${JSON.stringify(last)}`);
}
