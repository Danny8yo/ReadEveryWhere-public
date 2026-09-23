import { BookRetrievalService } from "../application/book-retrieval.service";
import type { KeywordIndexWorker } from "../application/ports/keyword-index.port";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, appendFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeSchema } from "../../../../platform/persistence/sqlite/schema-migrations";
import { seedUpgradeFixture } from "../../../../platform/persistence/sqlite/schema-upgrade.fixture";
import { SqliteKeywordIndexRepository } from "./sqlite-keyword-index.repository";
import type { IndexIdentity } from "../application/ports/keyword-index.port";
import type { EpubIndexChunk } from "@readeverywhere/epub-core/node";

const identity: IndexIdentity = {
  userId: 1,
  bookId: 1,
  key: "identity",
  artifact: { bookId: 1, artifactId: "artifact", fileChecksum: "checksum" },
  contentRevision: {
    fileChecksum: "checksum",
    extractorVersion: "extractor",
    normalizationVersion: "normalization",
  },
  version: {
    chunkerVersion: "chunker",
    tokenizerVersion: "tokenizer",
    queryPolicyVersion: "query",
  },
};
const chunk: EpubIndexChunk = {
  ordinal: 0,
  sectionIndex: 0,
  href: "chapter.xhtml",
  start: 0,
  end: 2,
  quote: "证据",
  quoteHash: "hash",
  displayedQuote: "证据",
  cfi: "epubcfi(/6/2!/4/2)",
  tokens: "t123 t456",
  source: { start: { path: [0], offset: 0 }, end: { path: [0], offset: 2 } },
};
const result = {
  chunkCount: 1,
  unavailable: [],
  chunkerVersion: "chunker",
  tokenizerVersion: "tokenizer",
};
describe("keyword index atomic generations", () => {
  let dir: string,
    db: DatabaseSync,
    other: DatabaseSync,
    repo: SqliteKeywordIndexRepository,
    second: SqliteKeywordIndexRepository;
  let current = true;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rew-index-"));
    db = new DatabaseSync(join(dir, "test.sqlite"));
    db.exec("PRAGMA foreign_keys=ON");
    initializeSchema(db);
    seedUpgradeFixture(db);
    other = new DatabaseSync(join(dir, "test.sqlite"));
    other.exec("PRAGMA foreign_keys=ON");
    current = true;
    const fence = {
      current: () => identity.artifact,
      assertCurrent: () => {
        if (!current) throw new Error("stale artifact");
      },
    };
    repo = new SqliteKeywordIndexRepository(db, fence, join(dir,"indices"));
    second = new SqliteKeywordIndexRepository(other, fence, join(dir,"indices"));
  });
  afterEach(() => {
    other.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  it("published files are immutable, missing/corrupt files fail and old FTS stays untouched", () => {
    const a=repo.begin(identity,"a");repo.append(identity,a.generation.id,"a",[chunk]);repo.publish(identity,a.generation.id,"a",result);
    const file=join(dir,"indices",a.generation.id+".sqlite");
    expect(existsSync(file)).toBe(true);
    expect(db.prepare("SELECT count(*) n FROM content_index_chunks").get()!.n).toBe(0);
    expect(()=>db.prepare("UPDATE content_index_files SET byte_count=NULL WHERE generation_id=?").run(a.generation.id)).toThrow();
    const before=repo.search(identity,a.generation.id,["t123"])[0].score;
    const otherIdentity={...identity,key:"distractor"};
    const b=repo.begin(otherIdentity,"b");repo.append(otherIdentity,b.generation.id,"b",[{...chunk,tokens:"t123 ".repeat(100)}]);
    expect(repo.search(identity,a.generation.id,["t123"])[0].score).toBe(before);
    repo.fail(b.generation.id,"b","interrupted");
    expect(repo.search(identity,a.generation.id,["t123"])[0].score).toBe(before);
    appendFileSync(file,"corrupt");
    expect(()=>repo.search(identity,a.generation.id,["t123"])).toThrow("INDEX_CORRUPT");
    rmSync(file);
    expect(()=>repo.search(identity,a.generation.id,["t123"])).toThrow();
  });
  it("a crash after file rename never publishes a partial pointer; retry uses a new file", () => {
    const a=repo.begin(identity,"a");repo.append(identity,a.generation.id,"a",[chunk]);
    db.exec("CREATE TRIGGER inject_publish_failure BEFORE UPDATE OF state ON content_index_generations WHEN new.state='ready' BEGIN SELECT RAISE(ABORT,'injected publication failure'); END");
    expect(()=>repo.publish(identity,a.generation.id,"a",result)).toThrow("injected publication failure");
    expect(repo.current(identity)).toBeNull();
    expect(existsSync(join(dir,"indices",a.generation.id+".sqlite"))).toBe(true);
    repo.recoverInterrupted();db.exec("DROP TRIGGER inject_publish_failure");
    const b=repo.begin(identity,"b",true);repo.append(identity,b.generation.id,"b",[chunk]);repo.publish(identity,b.generation.id,"b",result);
    expect(repo.current(identity)!.id).toBe(b.generation.id);
    expect(existsSync(join(dir,"indices",a.generation.id+".sqlite"))).toBe(true);
  });
  it("two connections share an active generation and a ready publication", () => {
    const first = repo.begin(identity, "a");
    expect(second.begin(identity, "b")).toEqual({
      created: false,
      generation: first.generation,
    });
    repo.append(identity, first.generation.id, "a", [chunk]);
    expect(second.current(identity)).toBeNull();
    expect(() => repo.publish(identity, first.generation.id, "a", {
      ...result, tokenizerVersion: "different-worker-version",
    })).toThrow("INDEX_VERSION_MISMATCH");
    expect(second.current(identity)).toBeNull();
    repo.publish(identity, first.generation.id, "a", result);
    expect(second.begin(identity, "b").created).toBe(false);
    expect(second.search(identity, first.generation.id, ["t123"])).toHaveLength(
      1,
    );
  });
  it("rejects incomplete publication and rolls back reordered batches", () => {
    const { generation } = repo.begin(identity, "a");
    expect(() => repo.publish(identity, generation.id, "a", result)).toThrow(
      "incomplete",
    );
    expect(() =>
      repo.append(identity, generation.id, "a", [{ ...chunk, ordinal: 1 }]),
    ).toThrow("SEQUENCE");
    expect(
      db.prepare("SELECT COUNT(*) n FROM content_index_position_chunks").get()!.n,
    ).toBe(0);
    expect(repo.current(identity)).toBeNull();
  });
  it("recovery prevents old owners publishing partial work and retries use new generation", () => {
    const { generation } = repo.begin(identity, "a");
    repo.append(identity, generation.id, "a", [chunk]);
    second.recoverInterrupted();
    expect(() => repo.publish(identity, generation.id, "a", result)).toThrow(
      "FENCED",
    );
    const retry = second.begin(identity, "b", true);
    expect(retry.generation.id).not.toBe(generation.id);
    expect(second.current(identity)).toBeNull();
    second.append(identity, retry.generation.id, "b", [chunk]);
    second.publish(identity, retry.generation.id, "b", result);
    expect(repo.current(identity)!.id).toBe(retry.generation.id);
  });
  it("rejects stale artifact publication without changing current", () => {
    const { generation } = repo.begin(identity, "a");
    repo.append(identity, generation.id, "a", [chunk]);
    current = false;
    expect(() => repo.publish(identity, generation.id, "a", result)).toThrow(
      "stale artifact",
    );
    expect(repo.current(identity)).toBeNull();
  });
  it("filters old generations and identity before the candidate limit", () => {
    const old = repo.begin(identity, "a");
    repo.append(
      identity,
      old.generation.id,
      "a",
      Array.from({ length: 16 }, (_, ordinal) => ({ ...chunk, ordinal })),
    );
    repo.publish(identity, old.generation.id, "a", {
      ...result,
      chunkCount: 16,
    });
    const next = repo.begin(identity, "b", true);
    repo.append(identity, next.generation.id, "b", [chunk]);
    repo.publish(identity, next.generation.id, "b", result);
    expect(repo.search(identity, old.generation.id, ["t123"])).toHaveLength(0);
    expect(
      repo.search({ ...identity, userId: 2 }, next.generation.id, ["t123"]),
    ).toHaveLength(0);
    expect(
      repo.search({ ...identity, bookId: 2 }, next.generation.id, ["t123"]),
    ).toHaveLength(0);
    expect(
      repo.search({ ...identity, key: "wrong" }, next.generation.id, ["t123"]),
    ).toHaveLength(0);
    expect(repo.search(identity, next.generation.id, ["t123"])).toHaveLength(1);
  });
  it("staging cannot be searched and wrong owners cannot append, publish or fail it", () => {
    const { generation } = repo.begin(identity, "owner");
    repo.append(identity, generation.id, "owner", [chunk]);
    expect(repo.search(identity, generation.id, ["t123"])).toEqual([]);
    expect(() =>
      second.append(identity, generation.id, "intruder", [
        { ...chunk, ordinal: 1 },
      ]),
    ).toThrow("FENCED");
    expect(() =>
      second.publish(identity, generation.id, "intruder", result),
    ).toThrow("FENCED");
    second.fail(generation.id, "intruder", "injected failure");
    expect(repo.latest(identity)!.state).toBe("building");
    repo.fail(generation.id, "owner", "worker failed");
    expect(() =>
      repo.append(identity, generation.id, "owner", [{ ...chunk, ordinal: 1 }]),
    ).toThrow("FENCED");
    expect(repo.search(identity, generation.id, ["t123"])).toEqual([]);
    const retry = repo.begin(identity, "new", true);
    repo.append(identity, retry.generation.id, "new", [chunk]);
    repo.publish(identity, retry.generation.id, "new", result);
    expect(repo.search(identity, retry.generation.id, ["t123"])).toHaveLength(
      1,
    );
  });
  it("reopened connection retains ready data and recovery fences half-built generations", () => {
    const ready = repo.begin(identity, "first");
    repo.append(identity, ready.generation.id, "first", [chunk]);
    repo.publish(identity, ready.generation.id, "first", result);
    const partial = repo.begin(identity, "stopped", true);
    repo.append(identity, partial.generation.id, "stopped", [chunk]);
    other.close();
    other = new DatabaseSync(join(dir, "test.sqlite"));
    other.exec("PRAGMA foreign_keys=ON");
    second = new SqliteKeywordIndexRepository(other, {
      current: () => identity.artifact,
      assertCurrent: () => {},
    }, join(dir,"indices"));
    second.recoverInterrupted();
    expect(second.current(identity)!.id).toBe(ready.generation.id);
    expect(second.search(identity, ready.generation.id, ["t123"])).toHaveLength(
      1,
    );
    expect(second.search(identity, partial.generation.id, ["t123"])).toEqual(
      [],
    );
    expect(() =>
      repo.append(identity, partial.generation.id, "stopped", [
        { ...chunk, ordinal: 1 },
      ]),
    ).toThrow("FENCED");
    expect(() =>
      repo.publish(identity, partial.generation.id, "stopped", result),
    ).toThrow("FENCED");
  });
  it("scope filtering precedes LIMIT with 48 stronger cross-revision distractors", () => {
    const foreign = {
      ...identity,
      key: "other-revision",
      contentRevision: {
        ...identity.contentRevision,
        extractorVersion: "other-extractor",
      },
    };
    const outside = repo.begin(foreign, "outside");
    for (let batch = 0; batch < 3; batch++)
      repo.append(
        foreign,
        outside.generation.id,
        "outside",
        Array.from({ length: 16 }, (_, n) => ({
          ...chunk,
          ordinal: batch * 16 + n,
          tokens: "t123 ".repeat(100),
        })),
      );
    repo.publish(foreign, outside.generation.id, "outside", {
      ...result,
      chunkCount: 48,
    });
    const target = repo.begin(identity, "target");
    repo.append(identity, target.generation.id, "target", [chunk]);
    repo.publish(identity, target.generation.id, "target", result);
    expect(repo.search(identity, target.generation.id, ["t123"])).toHaveLength(
      1,
    );
    for (const changed of [
      {
        ...identity,
        contentRevision: { ...identity.contentRevision, fileChecksum: "wrong" },
      },
      {
        ...identity,
        contentRevision: {
          ...identity.contentRevision,
          extractorVersion: "wrong",
        },
      },
      {
        ...identity,
        contentRevision: {
          ...identity.contentRevision,
          normalizationVersion: "wrong",
        },
      },
      { ...identity, artifact: { ...identity.artifact, artifactId: "wrong" } },
      {
        ...identity,
        version: { ...identity.version, chunkerVersion: "wrong" },
      },
      {
        ...identity,
        version: { ...identity.version, tokenizerVersion: "wrong" },
      },
    ])
      expect(repo.search(changed, target.generation.id, ["t123"])).toEqual([]);
  });

  it("12 concurrent service ensure calls across two connections start one build", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const build = jest.fn(
      async (
        _bytes: Buffer,
        onBatch: (chunks: EpubIndexChunk[]) => Promise<void>,
      ) => {
        await gate;
        await onBatch([chunk]);
        return result;
      },
    );
    const worker: KeywordIndexWorker = {
      version: identity.version,
      build,
      queries: () => [["t123"]],
      replay: async () => [],
      candidatesReplay: async () => [],
      expand: async () => [],
      context: async () => {
        throw new Error("unused");
      },
    };
    const source = {
      readOwnedEpubArtifact: async () => ({
        buffer: Buffer.from("fixture"),
        artifact: identity.artifact,
      }),
    };
    const fence = {
      current: () => identity.artifact,
      assertCurrent: () => {
        if (!current) throw new Error("stale artifact");
      },
    };
    const extractor = {
      extractorVersion: "extractor",
      normalizationVersion: "normalization",
      extract: async () => {
        throw new Error("unused");
      },
    };
    const first = new BookRetrievalService(
        source,
        fence,
        extractor,
        worker,
        repo,
      ),
      next = new BookRetrievalService(source, fence, extractor, worker, second);
    try {
      const states = await Promise.all(
        Array.from({ length: 12 }, (_, n) =>
          (n % 2 ? first : next).ensureIndex(1, identity),
        ),
      );
      expect(new Set(states.map((s) => s.generation)).size).toBe(1);
      expect(build).toHaveBeenCalledTimes(1);
      finish();
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      expect((await first.ensureIndex(1, identity)).state).toBe("ready");
      expect(build).toHaveBeenCalledTimes(1);
    } finally {
      finish();
      await first.onModuleDestroy();
      await next.onModuleDestroy();
    }
  });
  it("tokenizer upgrade isolates old ready data and publishes only a successful retry", async () => {
    const { TOKENIZER_VERSION, QUERY_POLICY_VERSION } = await import("@readeverywhere/epub-core/keywords");
    const oldVersion = { ...identity.version, tokenizerVersion: "rew-keywords-v1-cjk2-unicodeword-techhex-stop1-icu" + process.versions.icu };
    const newVersion = { ...identity.version, tokenizerVersion: TOKENIZER_VERSION, queryPolicyVersion: QUERY_POLICY_VERSION };
    expect(newVersion.tokenizerVersion).not.toBe(oldVersion.tokenizerVersion);
    const fence = { current: () => identity.artifact, assertCurrent: () => {} };
    const source = { readOwnedEpubArtifact: async () => ({ buffer: Buffer.from("fixture"), artifact: identity.artifact }) };
    const extractor = { extractorVersion: "extractor", normalizationVersion: "normalization", extract: async () => { throw new Error("unused"); } };
    const services: BookRetrievalService[] = [];
    let fail = true;
    const service = (version: typeof oldVersion, isNew: boolean) => {
      const worker: KeywordIndexWorker = {
        version,
        build: async (_bytes, batch) => {
          await batch([chunk]);
          if(isNew && fail) throw new Error("INDEX_RESOURCE_LIMIT: injected upgrade failure");
          return { ...result, tokenizerVersion: version.tokenizerVersion };
        },
        queries: () => [["t123"]], replay: async (_bytes, _scope, selected) => {
          expect(selected).toHaveLength(1);expect(selected[0].quoteHash).toBe(chunk.quoteHash);return [chunk];
        },
        candidatesReplay: async () => { throw new Error("unused"); },
        expand: async (_bytes, _scope, selected) => {
          expect(selected).toHaveLength(1);
          expect(selected[0].quoteHash).toBe(chunk.quoteHash);
          return [{...chunk,hitRanges:[{sectionIndex:chunk.sectionIndex,start:chunk.start,end:chunk.end}],contextTruncated:false}];
        },
        context: async () => { throw new Error("unused"); },
      };
      const svc = new BookRetrievalService(source, fence, extractor, worker, repo);
      services.push(svc);return svc;
    };
    const settle = async () => { for(let n=0;n<4;n++) await new Promise(resolve=>setImmediate(resolve)); };
    try {
      const old = service(oldVersion, false), next = service(newVersion, true);
      const oldStarted = await old.ensureIndex(1, identity);await settle();
      expect((await old.ensureIndex(1, identity)).state).toBe("ready");
      const staging = await next.ensureIndex(1, identity);
      expect(staging.state).toBe("building");expect(staging.generation).not.toBe(oldStarted.generation);
      await settle();
      await expect(next.ensureIndex(1, identity)).rejects.toThrow("injected upgrade failure");
      expect((await old.ensureIndex(1, identity)).generation).toBe(oldStarted.generation);
      expect(db.prepare("SELECT state FROM content_index_generations WHERE id=?").get(staging.generation)!.state).toBe("failed");
      fail=false;
      const retried=await next.ensureIndex(1, identity, {retryFailed:true});await settle();
      const ready=await next.ensureIndex(1, identity);
      expect(ready.state).toBe("ready");expect(ready.generation).toBe(retried.generation);
      expect(ready.generation).not.toBe(staging.generation);
      expect((await old.ensureIndex(1, identity)).generation).toBe(oldStarted.generation);
      expect(db.prepare("SELECT COUNT(*) n FROM content_index_position_chunks").get()!.n).toBe(3);
      const found=await next.retrieve(1,{...identity,queries:["fixture"],deadline:Date.now()+5000});
      expect(found.state).toBe("ready");expect(found.generation).toBe(ready.generation);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { for(const svc of services) await svc.onModuleDestroy(); }
  });

});
