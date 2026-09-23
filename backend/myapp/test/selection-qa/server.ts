/** Test-only Nest entry point for Playwright; never imported by production modules. */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { json, type Request, type Response } from "express";
import { createSelectionQaFixture } from "./http-fixture";
import { AttachBookFileUseCase } from "../../src/modules/intelligent-library/catalog/application/use-cases/attach-book-file.use-case";
import { selfAuthoredEpub } from "./self-authored-epub";
import { ScriptedQaModel, searchPlan } from "./mock-model.fixture";
import { SELECTION_QA_MODEL_PORT } from "../../src/modules/ai-reading/selection-qa/application/selection-qa-runtime.port";

async function main() {
  const root = mkdtempSync(join(tmpdir(), "rew-qa-playwright-"));
  const frontendOrigin = process.env.QA_FRONTEND_ORIGIN ?? "http://127.0.0.1:5194";
  process.env.CORS_ORIGIN = `${frontendOrigin},http://localhost:5173`;
  const model = new ScriptedQaModel();
  const secret = randomUUID();
  const fixture = await createSelectionQaFixture(
    root,
    [{ token: SELECTION_QA_MODEL_PORT, value: model }],
    (app) => {
      app.enableCors({
        origin: frontendOrigin,
        credentials: true,
      });
      const server = app.getHttpAdapter().getInstance();
      server.post(
        "/__test/selection-qa/scenario",
        json(),
        (req: Request, res: Response) => {
          if (req.header("x-test-secret") !== secret) {
            res.sendStatus(403);
            return;
          }
          const modes = {
            explain: {},
            streaming: { chunks: ["第一段解释。", "第二段解释。", "第三段解释。"], chunkDelayMs: 600 },
            markdown: { answer: "## 缓存解释\n\n**缓存命中**可以减少重复读取。\n\n- 先检查缓存\n- 再读取源数据\n\n```text\ncache.get(key)\n```\n" },
            unconfigured: { unconfigured: true },
            search: { plans: [[searchPlan], []] },
            slow: { delayMs: 3000 },
            failure: { failAfterFirstDelta: true },
            forged: { fakeCitation: true },
          };
          const mode = String(req.body.mode);
          if (!(mode in modes)) {
            res.status(400).json({ error: "unknown test scenario" });
            return;
          }
          model.use(modes[mode as keyof typeof modes]);
          res.json({ mode });
        },
      );
      server.post(
        "/__test/selection-qa/file",
        json(),
        async (req: Request, res: Response) => {
          if (req.header("x-test-secret") !== secret) {
            res.sendStatus(403);
            return;
          }
          try {
            const replacement =
              req.body.mode === "restore"
                ? fixture.epub
                : selfAuthoredEpub("替换版本", true);
            const user = (
              fixture.auth as typeof fixture.auth & { user: { userId: number } }
            ).user;
            await app.get(AttachBookFileUseCase).execute({
              userId: user.userId,
              bookId: fixture.bookId,
              content: replacement.bytes,
              sourcePlatform: null,
              sourceUrl: null,
              fileName: "replacement.epub",
              mimeType: "application/epub+zip",
              fileSize: replacement.bytes.length,
              checksum: replacement.checksum.slice(7),
            });
            res.json({ mode: req.body.mode });
          } catch (error) {
            console.error(error);
            res.status(500).json({ error: String(error) });
          }
        },
      );
    },
  );
  const port = Number(process.env.QA_TEST_PORT ?? 0);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("Invalid QA_TEST_PORT");
  await fixture.app.listen(port, "127.0.0.1");
  const descriptor = {
    nodeVersion: process.version,
    url: await fixture.app.getUrl(),
    root,
    secret,
    sessionCookie: fixture.auth.sessionCookie,
    user: (
      fixture.auth as typeof fixture.auth & {
        user: { userId: number; email: string };
      }
    ).user,
    otherSessionCookie: fixture.other.sessionCookie,
    bookId: fixture.bookId,
    selection: fixture.selection,
  };
  writeFileSync(join(root, "server.json"), JSON.stringify(descriptor, null, 2));
  if (process.env.QA_TEST_DESCRIPTOR)
    writeFileSync(
      process.env.QA_TEST_DESCRIPTOR,
      JSON.stringify(descriptor, null, 2),
    );
  console.log(
    JSON.stringify({
      selectionQaTestServer: {
        url: descriptor.url,
        root,
        nodeVersion: process.version,
      },
    }),
  );
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await fixture.app.close();
    rmSync(root, { recursive: true, force: true });
    process.exit(0);
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
