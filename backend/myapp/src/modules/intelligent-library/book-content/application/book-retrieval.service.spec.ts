import { setImmediate as turn } from "node:timers/promises";
import { BookRetrievalService } from "./book-retrieval.service";
import { BOOK_MAX_EXPAND_CHARS, BOOK_MAX_EXPAND_SELECTED } from "../../public/book-retrieval.port";
import type {
  KeywordIndexRepository,
  KeywordIndexWorker,
} from "./ports/keyword-index.port";
const scope = {
  bookId: 1,
  artifact: { bookId: 1, artifactId: "a", fileChecksum: "sum" },
  contentRevision: {
    fileChecksum: "sum",
    extractorVersion: "e",
    normalizationVersion: "n",
  },
};
const evidence = {
  sectionIndex: 0,
  href: "a.xhtml",
  start: 1,
  end: 3,
  quote: "证据",
  displayedQuote: "证据",
  quoteHash: "hash",
  cfi: "epubcfi(/6/2!/4/2)",
  source: { start: { path: [0], offset: 1 }, end: { path: [0], offset: 3 } },
};
describe("BookRetrievalService request boundaries", () => {
  let service: BookRetrievalService,
    repository: jest.Mocked<KeywordIndexRepository>,
    worker: jest.Mocked<KeywordIndexWorker>,
    source: { readOwnedEpubArtifact: jest.Mock };
  beforeEach(() => {
    repository = {
      recoverInterrupted: jest.fn(),
      current: jest.fn().mockReturnValue(null),
      latest: jest.fn().mockReturnValue(null),
      begin: jest
        .fn()
        .mockReturnValue({
          created: true,
          generation: {
            id: "g",
            state: "queued",
            error: null,
            unavailable: [],
          },
        }),
      append: jest.fn(),
      publish: jest.fn(),
      fail: jest.fn(),
      search: jest.fn().mockReturnValue([]),
      searchLists: jest.fn().mockReturnValue([]),
    };
    worker = {
      format: "unigram-file-v1",
      plan: jest.fn(),
      version: {
        chunkerVersion: "c",
        tokenizerVersion: "t",
        queryPolicyVersion: "q",
      },
      queries: jest.fn().mockReturnValue([["t"]]),
      build: jest
        .fn()
        .mockResolvedValue({
          chunkCount: 0,
          unavailable: [],
          chunkerVersion: "c",
          tokenizerVersion: "t",
        }),
      replay: jest.fn().mockResolvedValue([evidence]),
      ranges: jest.fn().mockResolvedValue({ candidates: [evidence], unavailable: [] }),
      candidatesReplay: jest.fn().mockResolvedValue([evidence]),
      expand: jest.fn().mockResolvedValue([{ ...evidence, hitRanges: [{sectionIndex:0,start:1,end:3}], contextTruncated:false }]),
      context: jest.fn().mockResolvedValue(evidence),
    };
    source = {
      readOwnedEpubArtifact: jest
        .fn()
        .mockResolvedValue({
          buffer: Buffer.from("bytes"),
          artifact: scope.artifact,
        }),
    };
    service = new BookRetrievalService(
      source,
      { current: () => scope.artifact, assertCurrent: () => {} },
      { extractorVersion: "e", normalizationVersion: "n", extract: jest.fn() },
      worker,
      repository,
    );
  });
  afterEach(async () => {
    await service.onModuleDestroy();
  });
  it("returns retrieval order even when EPUB replay groups results by chapter", async () => {
    repository.current.mockReturnValue({id:"g",state:"ready",error:null,unavailable:[]});
    const later={...evidence,sectionIndex:2,href:"c.xhtml",quote:"后章",quoteHash:"later",displayedQuote:"后章"};
    repository.search.mockReturnValue([{...later,id:2,tokens:"t",score:-2},{...evidence,id:1,tokens:"t",score:-1}]);
    worker.expand.mockResolvedValue([evidence,later].map(e => ({...e, hitRanges:[{sectionIndex:e.sectionIndex,start:e.start,end:e.end}], contextTruncated:false})));
    const result=await service.retrieve(1,{...scope,queries:["test"],deadline:Date.now()+1000});
    expect(result.state).toBe("ready");
    if(result.state!=="ready") throw new Error("Expected ready");
    expect(result.candidates.map(c=>c.sectionIndex)).toEqual([2,0]);
  });
  it("replays up to twenty complete candidates in ranking order and reports budget admission", async () => {
    repository.current.mockReturnValue({id:"g",state:"ready",error:null,unavailable:[]});
    const chunks = Array.from({ length: 20 }, (_, id) => ({ ...evidence, id, start: id * 10, end: id * 10 + 2, tokens: "t", score: -1 }));
    repository.search.mockReturnValue(chunks);
    worker.candidatesReplay.mockImplementation(async (_bytes, _scope, ranges) => ranges.map(range => ({ ...evidence, ...range })).reverse());
    const result = await service.searchCandidates(1, { ...scope, queries: ["证据"], limit: 20, maxChars: 40, deadline: Date.now()+1000 });
    if(result.state!=="ready") throw new Error("Expected ready");
    expect(result.candidates).toHaveLength(20);
    expect(result.candidates.map(e => e.start)).toEqual(chunks.map(e => e.start));
    expect(result.budgetLimited).toBe(false);
    expect(worker.expand).not.toHaveBeenCalled();
    const limited = await service.searchCandidates(1, { ...scope, queries: ["证据"], maxChars: 5, deadline: Date.now()+1000 });
    expect(limited).toMatchObject({ state:"ready", budgetLimited:true, candidates:[{quote:"证据"},{quote:"证据"}] });
    await expect(service.searchCandidates(1, { ...scope, queries:["证据"], limit:21, deadline:Date.now()+1000 })).rejects.toThrow("1–20");
    await expect(service.searchCandidates(1, { ...scope, queries:["证据"], maxChars:12001, deadline:Date.now()+1000 })).rejects.toThrow("1–12000");
  });
  it("labels v4 recall lists with the de-duplicated query order", async () => {
    repository.current.mockReturnValue({ id: "g", state: "ready", error: null, unavailable: [] });
    worker.queries.mockReturnValue([["ta"], ["tb"]]);
    repository.search.mockImplementation((_i, _g, tokens) => tokens[0] === "tb" ? [{ ...evidence, id: 2, start: 10, end: 12, tokens: "tb", score: -1 }] : []);
    const pool = await service.searchPool(1, { ...scope, queries: ["A", "A", "B"], deadline: Date.now() + 1000 });
    if (pool.state !== "ready") throw new Error("Expected ready");
    expect(pool.lists.map(l => l.query)).toEqual(["A", "B"]);
    expect(pool.candidates[0].paths).toEqual([{ kind: "phrase", query: "B", rank: 0 }]);
  });
  describe("dual-v1 fusion", () => {
    const list = (kind: string, weight: number) => ({ kind, table: "word", query: "q", phrases: ["w00"], minimum: 1, weight }) as never;
    const chunk = (id: number, start: number, end = start + 2) => ({ ...evidence, id, start, end, tokens: "t", score: -1 });
    beforeEach(() => {
      (worker as { format: string }).format = "dual-file-v1";
      repository.current.mockReturnValue({ id: "g", state: "ready", error: null, unavailable: [] });
    });
    it("C1 sums weight/(60+rank) across lists and records every finding path", async () => {
      worker.plan.mockReturnValue({ version: "v", lists: [list("word_query", 1), list("bigram_soft", 0.6)] });
      repository.searchLists.mockReturnValue([
        { list: list("word_query", 1), considered: 1, minimum: 1, hits: [chunk(1, 0), chunk(2, 10)] },
        { list: list("bigram_soft", 0.6), considered: 1, minimum: 1, hits: [chunk(2, 10)] },
      ]);
      const pool = await service.searchPool(1, { ...scope, queries: ["q"], informationNeed: "need", deadline: Date.now() + 1000 });
      if (pool.state !== "ready") throw new Error("Expected ready");
      // chunk 2: 1/62 + 0.6/61 > chunk 1: 1/61
      expect(pool.candidates.map(c => c.start)).toEqual([10, 0]);
      expect(pool.candidates[0].paths).toEqual([{ kind: "word_query", query: "q", rank: 1 }, { kind: "bigram_soft", query: "q", rank: 0 }]);
      expect(pool.candidates[1].paths).toEqual([{ kind: "word_query", query: "q", rank: 0 }]);
      expect(pool.lists.map(l => [l.kind, l.hitCount])).toEqual([["word_query", 2], ["bigram_soft", 1]]);
      expect(worker.plan).toHaveBeenCalledWith(["q"], "need");
      expect(repository.search).not.toHaveBeenCalled();
    });
    it("C2 equal fused scores keep the lower chunk id first", async () => {
      worker.plan.mockReturnValue({ version: "v", lists: [list("word_query", 1), list("char", 1)] });
      repository.searchLists.mockReturnValue([
        { list: list("word_query", 1), considered: 1, minimum: 1, hits: [chunk(9, 50)] },
        { list: list("char", 1), considered: 1, minimum: 1, hits: [chunk(3, 0)] },
      ]);
      const pool = await service.searchPool(1, { ...scope, queries: ["q"], deadline: Date.now() + 1000 });
      if (pool.state !== "ready") throw new Error("Expected ready");
      expect(pool.candidates.map(c => c.start)).toEqual([0, 50]);
    });
    it("C3/C4 drops a ≥80% same-section overlap and caps the pool", async () => {
      worker.plan.mockReturnValue({ version: "v", lists: [list("word_query", 1)] });
      repository.searchLists.mockReturnValue([{ list: list("word_query", 1), considered: 1, minimum: 1,
        hits: [chunk(1, 0, 10), chunk(2, 1, 10), ...Array.from({ length: 40 }, (_, n) => chunk(10 + n, 100 + n * 20))] }]);
      const pool = await service.searchPool(1, { ...scope, queries: ["q"], poolLimit: 30, deadline: Date.now() + 1000 });
      if (pool.state !== "ready") throw new Error("Expected ready");
      expect(pool.candidates).toHaveLength(30);
      expect(pool.candidates.map(c => c.start)).not.toContain(1);
      expect(pool.candidates.map(c => c.fusedRank)).toEqual(Array.from({ length: 30 }, (_, n) => n));
      await expect(service.searchPool(1, { ...scope, queries: ["q"], poolLimit: 41, deadline: Date.now() + 1000 })).rejects.toThrow("1–40");
    });
    it("C5 a building generation returns building without partial lists", async () => {
      repository.current.mockReturnValue(null);
      repository.latest.mockReturnValue({ id: "g", state: "building", error: null, unavailable: [] });
      worker.plan.mockReturnValue({ version: "v", lists: [list("word_query", 1)] });
      const pool = await service.searchPool(1, { ...scope, queries: ["q"], deadline: Date.now() + 60 });
      expect(pool).toEqual({ state: "building", generation: "g" });
      expect(repository.searchLists).not.toHaveBeenCalled();
    });
  });
  it("rejects candidate raw quote corruption even when range and CFI match", async () => {
    repository.current.mockReturnValue({id:"g",state:"ready",error:null,unavailable:[]});
    repository.search.mockReturnValue([{...evidence,id:1,tokens:"t",score:-1}]);
    worker.candidatesReplay.mockResolvedValue([{...evidence,displayedQuote:"损坏"}]);
    await expect(service.searchCandidates(1, {...scope,queries:["证据"],deadline:Date.now()+1000})).rejects.toMatchObject({details:{reason:"TEXT_QUOTE_MISMATCH"}});
  });
  it("expands selected verified evidence without indexing and rejects omitted selected hits", async () => {
    const candidate = await service.readContext(1, {...scope,...evidence,deadline:Date.now()+1000});
    const result = await service.expandSelected(1, {...scope,evidence:[candidate],maxChars:8000,deadline:Date.now()+1000});
    expect(result.candidates).toHaveLength(1);
    expect(result.contextWindows[0].hitRanges).toEqual([{sectionIndex:0,start:1,end:3}]);
    expect(worker.expand).toHaveBeenCalledWith(expect.any(Buffer),expect.anything(),[candidate],{maxChars:8000,maxWindowChars:1600,limit:1,preserveAllHits:true},expect.any(Number),undefined);
    expect(repository.begin).not.toHaveBeenCalled();
    worker.expand.mockResolvedValue([]);
    await expect(service.expandSelected(1, {...scope,evidence:[candidate],maxChars:8000,deadline:Date.now()+1000})).rejects.toThrow("lost evidence");
    candidate.locator.textQuote = {exact:"different"};
    await expect(service.expandSelected(1, {...scope,evidence:[candidate],maxChars:8000,deadline:Date.now()+1000})).rejects.toMatchObject({details:{reason:"LOCATOR_INVALID"}});
  });
  it("uses the public expansion range limit while retaining the shared character budget", async () => {
    const candidate = await service.readContext(1, {...scope,...evidence,deadline:Date.now()+1000});
    const selected = Array.from({ length: BOOK_MAX_EXPAND_SELECTED }, () => candidate);
    worker.expand.mockResolvedValue(selected.map(() => ({ ...evidence, hitRanges: [{ sectionIndex: 0, start: 1, end: 3 }], contextTruncated: false })));
    const result = await service.expandSelected(1, {...scope,evidence:selected,maxChars:BOOK_MAX_EXPAND_CHARS,deadline:Date.now()+1000});
    expect(result.candidates).toHaveLength(BOOK_MAX_EXPAND_SELECTED);
    await expect(service.expandSelected(1, {...scope,evidence:[...selected,candidate],maxChars:8000,deadline:Date.now()+1000})).rejects.toThrow(`1–${BOOK_MAX_EXPAND_SELECTED} ranges`);
    await expect(service.expandSelected(1, {...scope,evidence:selected,maxChars:BOOK_MAX_EXPAND_CHARS+1,deadline:Date.now()+1000})).rejects.toThrow(`1–${BOOK_MAX_EXPAND_CHARS} characters`);
  });
  it("passes a shared character budget and keeps expanded windows instead of original chunks", async () => {
    repository.current.mockReturnValue({id:"g",state:"ready",error:null,unavailable:[]});
    repository.search.mockReturnValue([{...evidence,id:1,tokens:"t",score:-1}]);
    worker.expand.mockResolvedValue([{...evidence,start:0,end:4,quote:"前证据后",displayedQuote:"前证据后",hitRanges:[{sectionIndex:0,start:1,end:3}],contextTruncated:false}]);
    const result=await service.retrieve(1,{...scope,queries:["test"],maxChars:4000,deadline:Date.now()+1000});
    expect(worker.expand).toHaveBeenCalledWith(expect.any(Buffer),expect.anything(),expect.any(Array),{maxChars:4000,maxWindowChars:2400,limit:5},expect.any(Number),undefined);
    if(result.state!=="ready") throw new Error("Expected ready");
    expect(result.candidates[0]).toMatchObject({start:0,end:4,quote:"前证据后"});
    expect(result.contextWindows[0].hitRanges).toEqual([{sectionIndex:0,start:1,end:3}]);
    expect(worker.replay).not.toHaveBeenCalled();
  });
  it("rejects windows outside the granted budget or unrelated to an indexed hit", async () => {
    repository.current.mockReturnValue({id:"g",state:"ready",error:null,unavailable:[]});
    repository.search.mockReturnValue([{...evidence,id:1,tokens:"t",score:-1}]);
    await expect(service.retrieve(1,{...scope,queries:["test"],maxChars:1,deadline:Date.now()+1000})).rejects.toThrow("budget");
    worker.expand.mockResolvedValue([{...evidence,hitRanges:[{sectionIndex:0,start:0,end:1}],contextTruncated:false}]);
    await expect(service.retrieve(1,{...scope,queries:["test"],deadline:Date.now()+1000})).rejects.toThrow("indexed hit");
  });
  it("distinguishes a budget that cannot fit any complete hit from an empty search", async () => {
    repository.current.mockReturnValue({id:"g",state:"ready",error:null,unavailable:[]});
    repository.search.mockReturnValue([{...evidence,id:1,tokens:"t",score:-1}]);
    worker.expand.mockResolvedValue([]);
    const result=await service.retrieve(1,{...scope,queries:["test"],maxChars:1,deadline:Date.now()+1000});
    expect(result).toMatchObject({state:"ready",candidates:[],budgetLimited:true});
    repository.search.mockReturnValue([]);
    const empty=await service.retrieve(1,{...scope,queries:["test"],maxChars:1,deadline:Date.now()+1000});
    expect(empty).toMatchObject({state:"ready",candidates:[],budgetLimited:false});
  });
  it("query policy version changes leave the positional index identity unchanged", async () => {
    await service.ensureIndex(1,scope);await turn();
    worker.version.queryPolicyVersion="different-query-policy";
    await service.ensureIndex(1,scope);
    expect(repository.begin.mock.calls[0][0].key).toBe(repository.begin.mock.calls[1][0].key);
  });
  it("keeps failed generations visible until explicit retry and preserves resource reason", async () => {
    repository.latest.mockReturnValue({ id: "failed", state: "failed", error: "INDEX_RESOURCE_LIMIT: process RSS budget exceeded", unavailable: [] } as any);
    await expect(service.ensureIndex(1, scope)).rejects.toMatchObject({ details: { reason: "INDEX_RESOURCE_LIMIT" } });
    expect(worker.build).not.toHaveBeenCalled();
    await expect(service.ensureIndex(1, scope, { retryFailed: true })).resolves.toMatchObject({ state: "building" });
    await turn(); expect(worker.build).toHaveBeenCalledTimes(1);
    expect(repository.begin).toHaveBeenCalledWith(expect.anything(), expect.any(String), true);
  });
  it("canonicalizes revision property ordering into the same generation identity", async () => {
    await service.ensureIndex(1, scope);
    await turn();
    await service.ensureIndex(1, {
      ...scope,
      contentRevision: {
        normalizationVersion: "n",
        fileChecksum: "sum",
        extractorVersion: "e",
      },
    });
    expect(repository.begin.mock.calls[0][0].key).toBe(
      repository.begin.mock.calls[1][0].key,
    );
  });
  it("cleans up a synchronously throwing worker after recording a terminal failure", async () => {
    worker.build.mockImplementation(() => {
      throw new Error("INDEX_RESOURCE_LIMIT");
    });
    await service.ensureIndex(1, scope);
    await turn();
    expect(repository.fail).toHaveBeenCalledWith(
      "g",
      expect.any(String),
      "INDEX_RESOURCE_LIMIT",
    );
    expect(
      (service as unknown as { tasks: Map<string, unknown> }).tasks.size,
    ).toBe(0);
  });
  it("rejects exhausted byte-read deadline before returning an empty ready result", async () => {
    repository.current.mockReturnValue({
      id: "g",
      state: "ready",
      error: null,
      unavailable: [],
    });
    source.readOwnedEpubArtifact.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return { buffer: Buffer.from("bytes"), artifact: scope.artifact };
    });
    await expect(
      service.retrieve(1, {
        ...scope,
        queries: ["SQL"],
        deadline: Date.now() + 10,
      }),
    ).rejects.toMatchObject({ details: { reason: "INDEX_DEADLINE" } });
    expect(repository.search).not.toHaveBeenCalled();
  });
  it("replays reordered revision fields but rejects mismatched raw quote and locator anchors", async () => {
    const candidate = await service.readContext(1, {
      ...scope,
      ...evidence,
      deadline: Date.now() + 1000,
    });
    candidate.locator.contentRevision = {
      normalizationVersion: "n",
      fileChecksum: "sum",
      extractorVersion: "e",
    };
    await expect(
      service.replay(1, {
        ...scope,
        evidence: [candidate],
        deadline: Date.now() + 1000,
      }),
    ).resolves.toHaveLength(1);
    await expect(
      service.replay(1, {
        ...scope,
        evidence: [{ ...candidate, displayedQuote: "损坏" }],
        deadline: Date.now() + 1000,
      }),
    ).rejects.toMatchObject({ details: { reason: "TEXT_QUOTE_MISMATCH" } });
    candidate.locator.readerAnchor = { epubcfi: "wrong" };
    await expect(
      service.replay(1, {
        ...scope,
        evidence: [candidate],
        deadline: Date.now() + 1000,
      }),
    ).rejects.toMatchObject({ details: { reason: "LOCATOR_INVALID" } });
  });
  it("reads context while a shared index build remains pending", async () => {
    worker.build.mockImplementation(
      (_bytes, _batch, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        ),
    );
    await service.ensureIndex(1, scope);
    await expect(
      service.readContext(1, {
        ...scope,
        ...evidence,
        deadline: Date.now() + 1000,
      }),
    ).resolves.toMatchObject({ quote: "证据" });
    expect(repository.publish).not.toHaveBeenCalled();
  });
});
