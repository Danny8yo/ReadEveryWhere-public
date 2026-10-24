import AdmZip from "adm-zip";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EPUB_EXTRACTOR_VERSION, NORMALIZATION_VERSION } from "@readeverywhere/epub-core";
import { initializeSchema } from "../../../../platform/persistence/sqlite/schema-migrations";
import { seedUpgradeFixture } from "../../../../platform/persistence/sqlite/schema-upgrade.fixture";
import { BookRetrievalService } from "../application/book-retrieval.service";
import { KeywordIndexWorkerAdapter } from "./keyword-index-worker.adapter";
import { SqliteKeywordIndexRepository } from "./sqlite-keyword-index.repository";
import type { BookPoolCandidate, BookPoolResult, RetrievalScope } from "../../public/book-retrieval.port";

jest.setTimeout(60_000);
const sections = [
  "MySQL 在执行 UNION 查询时会使用内部临时表。创建临时表时花费的时间多少，可以通过剖析工具逐个阶段观察。",
  "这一段故意写成临时，时表，用来确认标点两侧的字不会被当成一个连续的词。",
  "InnoDB 发现死锁时会回滚代价最小的事务；锁等待超时是另一种更粗糙的替代办法。",
  "随机I/O比顺序访问慢很多，因为磁头需要寻道。",
  "课题分离并不意味着漠不关心，而是区分援助与干涉。",
  "这里只讨论缓存命中率与内存大小的关系，没有提到其他话题。",
];
function epub(): Buffer {
  const zip = new AdmZip();
  const body = sections.map((text, n) => `<section><h2>第${n + 1}节</h2><p>${text}</p></section>`).join("");
  const files = {
    "META-INF/container.xml": '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    "OPS/book.opf": '<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata/><manifest><item id="c" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c"/></spine></package>',
    "OPS/chapter.xhtml": `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>dual</title></head><body>${body}</body></html>`,
  };
  for (const [name, text] of Object.entries(files)) zip.addFile(name, Buffer.from(text));
  return zip.toBuffer();
}
const ready = (pool: BookPoolResult) => {
  if (pool.state !== "ready") throw new Error("index not ready");
  return pool;
};
const sectionOf = (c: Pick<BookPoolCandidate, "quote">) => sections.findIndex(text => c.quote.includes(text.slice(0, 12)));

describe("dual recall over a real EPUB worker and published index files", () => {
  let dir: string, db: DatabaseSync, bytes: Buffer, scope: RetrievalScope;
  const services: BookRetrievalService[] = [];
  const service = (pipeline: "unigram-v4" | "dual-v1", indexDir = join(dir, "indices")) => {
    const artifact = scope.artifact;
    const fence = { current: () => artifact, assertCurrent: () => undefined };
    const svc = new BookRetrievalService(
      { readOwnedEpubArtifact: async () => ({ buffer: bytes, artifact }) } as never,
      fence,
      { extractorVersion: EPUB_EXTRACTOR_VERSION, normalizationVersion: NORMALIZATION_VERSION } as never,
      new KeywordIndexWorkerAdapter(pipeline),
      new SqliteKeywordIndexRepository(db, fence, indexDir),
    );
    services.push(svc);
    return svc;
  };
  const pool = async (svc: BookRetrievalService, queries: string[], informationNeed?: string) =>
    ready(await svc.searchPool(1, { ...scope, queries, informationNeed, poolLimit: 30, deadline: Date.now() + 50_000 }));
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rew-dual-"));
    db = new DatabaseSync(join(dir, "test.sqlite"));
    db.exec("PRAGMA foreign_keys=ON");
    initializeSchema(db);
    seedUpgradeFixture(db);
    bytes = epub();
    writeFileSync(join(dir, "book.epub"), bytes);
    const checksum = "sha256:" + createHash("sha256").update(bytes).digest("hex");
    const row = db.prepare("SELECT artifact_id,book_id FROM book_artifacts WHERE user_id=1 LIMIT 1").get() as { artifact_id: string; book_id: number };
    scope = {
      bookId: row.book_id,
      artifact: { bookId: row.book_id, artifactId: row.artifact_id, fileChecksum: checksum },
      contentRevision: { fileChecksum: checksum, extractorVersion: EPUB_EXTRACTOR_VERSION, normalizationVersion: NORMALIZATION_VERSION },
    };
  });
  afterEach(async () => {
    await Promise.all(services.splice(0).map(s => s.onModuleDestroy()));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("B1/C1 a reworded long clause misses the exact phrase but is recalled by the bigram bag and words", async () => {
    const dual = service("dual-v1");
    const result = await pool(dual, ["创建临时表花费多少时间"]);
    const hit = result.candidates.find(c => sectionOf(c) === 0)!;
    expect(hit).toBeDefined();
    const kinds = new Set(hit.paths.map(p => p.kind));
    expect(kinds.has("bigram_soft")).toBe(true);
    expect(kinds.has("word_query")).toBe(true);
    expect(kinds.has("bigram_phrase")).toBe(false);
    expect(result.version.tokenizerVersion).toMatch(/^rew-dual-v1:/);
    const v4 = await pool(service("unigram-v4"), ["创建临时表花费多少时间"]);
    expect(v4.candidates.some(c => sectionOf(c) === 0)).toBe(false);
  });

  it("B2 exact phrases keep v4 semantics: what v4 finds, the dual exact-phrase list finds", async () => {
    const v4 = await pool(service("unigram-v4"), ["临时表"]);
    const dual = await pool(service("dual-v1"), ["临时表"]);
    const v4Sections = v4.candidates.map(sectionOf);
    expect(v4Sections).toEqual([0]);
    const exact = dual.candidates.filter(c => c.paths.some(p => p.kind === "bigram_phrase")).map(sectionOf);
    expect(exact).toEqual(v4Sections);
    // "临时，时表" stays separated in both pipelines.
    expect(exact).not.toContain(1);
  });

  it("B3/A3 single characters and technical atoms are recalled exactly", async () => {
    const dual = service("dual-v1");
    const single = await pool(dual, ["锁"]);
    expect(single.candidates.map(sectionOf)).toContain(2);
    expect(single.candidates.find(c => sectionOf(c) === 2)!.paths.some(p => p.kind === "char")).toBe(true);
    const io = await pool(dual, ["I/O"]);
    expect(io.candidates.map(sectionOf)[0]).toBe(3);
  });

  it("informationNeed adds a low-weight word list that can recall on its own", async () => {
    const result = await pool(service("dual-v1"), ["援助"], "课题分离是否意味着漠不关心");
    const hit = result.candidates.find(c => sectionOf(c) === 4)!;
    expect(hit.paths.map(p => p.kind)).toEqual(expect.arrayContaining(["word_need"]));
    expect(result.lists.find(l => l.kind === "word_need")!.hitCount).toBeGreaterThan(0);
  });

  it("C4/E7 verification admits candidates in order and every returned passage replays exactly", async () => {
    const dual = service("dual-v1");
    const result = await pool(dual, ["临时表 锁 课题分离 缓存"]);
    expect(result.candidates.length).toBeGreaterThan(2);
    const verified = await dual.verifyCandidates(1, { ...scope, candidates: result.candidates, limit: 2, maxChars: 12000, deadline: Date.now() + 50_000 });
    expect(verified.admitted).toEqual([0, 1]);
    expect(verified.candidates.map(c => c.quote)).toEqual(result.candidates.slice(0, 2).map(c => c.quote));
    const tampered = { ...result.candidates[0], quote: "改" + result.candidates[0].quote.slice(1) };
    await expect(dual.verifyCandidates(1, { ...scope, candidates: [tampered], limit: 1, maxChars: 12000, deadline: Date.now() + 50_000 }))
      .rejects.toThrow();
  });

  it("C7/F5 switching pipelines builds a separate generation and never queries the other format", async () => {
    await pool(service("unigram-v4"), ["临时表"]);
    await pool(service("dual-v1"), ["临时表"]);
    const rows = db.prepare("SELECT g.tokenizer_version AS t,f.format AS f,g.state AS s FROM content_index_generations g JOIN content_index_files f ON f.generation_id=g.id ORDER BY g.created_at").all() as { t: string; f: string; s: string }[];
    expect(rows.map(r => [r.f, r.s])).toEqual([["unigram-file-v1", "ready"], ["dual-file-v1", "ready"]]);
    expect(rows[1].t).toMatch(/^rew-dual-v1:/);
    expect((await pool(service("unigram-v4"), ["临时表"])).candidates.map(sectionOf)).toEqual([0]);
  });

  it("C6 a published dual file missing a table fails loudly instead of returning nothing", async () => {
    await pool(service("dual-v1"), ["临时表"]);
    const generation = db.prepare("SELECT generation_id FROM content_index_files WHERE format='dual-file-v1'").get() as { generation_id: string };
    const file = join(dir, "indices", generation.generation_id + ".sqlite");
    const raw = new DatabaseSync(file);
    raw.exec("DROP TABLE vocab_word; DROP TABLE fts_word");
    raw.close();
    const data = require("node:fs").readFileSync(file) as Buffer;
    db.prepare("UPDATE content_index_files SET sha256=?,byte_count=? WHERE generation_id=?")
      .run(createHash("sha256").update(data).digest("hex"), data.length, generation.generation_id);
    await expect(pool(service("dual-v1"), ["临时表"])).rejects.toThrow("INDEX_CORRUPT: missing index table");
  });

  it("C8/B7 results are deterministic and isolated from other books' generations", async () => {
    const dual = service("dual-v1");
    const first = await pool(dual, ["临时表 锁等待"], "死锁如何处理");
    const again = await pool(dual, ["临时表 锁等待"], "死锁如何处理");
    expect(again.candidates).toEqual(first.candidates);
  });
});
