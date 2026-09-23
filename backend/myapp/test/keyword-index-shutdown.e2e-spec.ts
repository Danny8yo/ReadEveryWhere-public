import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createCompatApp } from "./compat-e2e.helper";
import { SqliteService } from "../src/platform/persistence/sqlite/sqlite.service";
import { seedUpgradeFixture } from "../src/platform/persistence/sqlite/schema-upgrade.fixture";
import {
  BOOK_RETRIEVAL_PORT,
  type BookRetrievalPort,
} from "../src/modules/intelligent-library/public/book-retrieval.port";
import { CatalogBookContentSourceAdapter } from "../src/modules/intelligent-library/book-content/infrastructure/catalog-book-content-source.adapter";
import { KeywordIndexWorkerAdapter } from "../src/modules/intelligent-library/book-content/infrastructure/keyword-index-worker.adapter";
import {
  EPUB_EXTRACTOR_VERSION,
  NORMALIZATION_VERSION,
} from "@readeverywhere/epub-core";
describe("active keyword index shutdown on real AppModule", () => {
  it("persists failed generation before SQLite shutdown phase", async () => {
    const root = mkdtempSync(join(tmpdir(), "rew-index-shutdown-"));
    const checksum = "sha256:" + "a".repeat(64);
    const artifact = {
      bookId: 1,
      artifactId: "artifact",
      fileChecksum: checksum,
    };
    let started!: () => void;
    const active = new Promise<void>((r) => (started = r));
    const spy = jest
      .spyOn(KeywordIndexWorkerAdapter.prototype, "build")
      .mockImplementation(
        (_bytes, _batch, signal) =>
          new Promise((_resolve, reject) => {
            started();
            signal.addEventListener(
              "abort",
              () => setTimeout(() => reject(signal.reason), 20),
              { once: true },
            );
          }),
      );
    let app: Awaited<ReturnType<typeof createCompatApp>> | undefined;
    try {
      app = await createCompatApp(root, [
        {
          token: CatalogBookContentSourceAdapter,
          value: {
            readOwnedEpubArtifact: async () => ({
              buffer: Buffer.from("fixture"),
              artifact,
            }),
          },
        },
      ]);
      const db = app.get(SqliteService).getDatabase();
      seedUpgradeFixture(db);
      db.prepare("UPDATE book_artifacts SET checksum=?").run(checksum);
      const service = app.get<BookRetrievalPort>(BOOK_RETRIEVAL_PORT);
      await service.ensureIndex(1, {
        bookId: 1,
        artifact,
        contentRevision: {
          fileChecksum: checksum,
          extractorVersion: EPUB_EXTRACTOR_VERSION,
          normalizationVersion: NORMALIZATION_VERSION,
        },
      });
      await active;
      await app.close();
      app = undefined;
      const reopened = new DatabaseSync(join(root, "test.sqlite"));
      try {
        expect(
          reopened
            .prepare("SELECT state,error FROM content_index_generations")
            .get(),
        ).toMatchObject({
          state: "failed",
          error: expect.stringContaining("INDEX_INTERRUPTED"),
        });
        expect(reopened.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally {
        reopened.close();
      }
    } finally {
      if (app) await app.close();
      spy.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
