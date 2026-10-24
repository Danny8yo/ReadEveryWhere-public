import { createHash } from "node:crypto";
import { inspectorEpubFixtures } from "../../../../../tools/book-document-inspector/fixtures/epub-fixtures";
import { EpubDocumentExtractor } from "../infrastructure/epub-document.extractor";
import { KeywordIndexWorkerAdapter } from "../infrastructure/keyword-index-worker.adapter";
import { BookDocumentLoader } from "./book-document.loader";
import { BookRetrievalService } from "./book-retrieval.service";
import { BookStructuredContentService } from "./book-structured-content.service";
import { GetBookTocUseCase } from "./use-cases/get-book-toc.use-case";
import { ReadBookUseCase } from "./use-cases/read-book.use-case";
import { ReadBookFromTocUseCase } from "./use-cases/read-book-from-toc.use-case";
import { structureAt } from "./reader-tool.utils";
import { QaCoverage } from "../../../ai-reading/selection-qa/domain/qa-coverage";
import type { KeywordIndexRepository } from "./ports/keyword-index.port";

// 本文件经 epub-core 启动真实 Worker 线程解析 EPUB（每次调用新建线程并重新解压），
// 本地并行全量时单个用例接近 5s，2 核 CI runner 上会超过 Jest 默认 5s 超时。
jest.setTimeout(30_000);

async function fixture(id: string) {
  const bytes = inspectorEpubFixtures.find(f => f.id === id)!.epub;
  const artifact = { bookId: 1, artifactId: "isolated", fileChecksum: `sha256:${createHash("sha256").update(bytes).digest("hex")}` };
  let current = true;
  const fence = { current: () => artifact, assertCurrent: () => { if (!current) throw new Error("artifact replaced"); } };
  const source = { findOwnedBook: () => ({ id: 1, title: "fixture", authors: [] }), readOwnedEpub: async () => bytes,
    readOwnedEpubArtifact: async () => ({ buffer: bytes, artifact }) };
  const extractor = new EpubDocumentExtractor();
  const extraction = jest.spyOn(extractor,"extract");
  const loader = new BookDocumentLoader(source, extractor, { load: async () => null, save: async () => {} });
  const document = await loader.load(1, 1);
  const retrieval = new BookRetrievalService(source, fence, extractor, new KeywordIndexWorkerAdapter(), {} as KeywordIndexRepository);
  const read = new ReadBookUseCase(source, loader);
  const service = new BookStructuredContentService(loader, new GetBookTocUseCase(loader), read, new ReadBookFromTocUseCase(loader, read), retrieval, fence);
  const scope = { bookId: 1, artifact, contentRevision: document.revision };
  const execution = { signal: new AbortController().signal, deadline: Date.now() + 30000 };
  return { service, scope, execution, document, source, extractor, extraction, replace: () => { current = false; } };
}
describe("structured reading using real shared EPUB source mapping", () => {
  it("reuses the cold extraction for cached structure reads and refuses the same node under another revision", async () => {
    const f=await fixture("spanning-node");
    expect(f.extraction).toHaveBeenCalledTimes(1);
    for(let n=0;n<2;n++)await f.service.discover(1,f.scope,f.execution);
    expect(f.extraction).toHaveBeenCalledTimes(1);
    await expect(f.service.readNode(1,{...f.scope,contentRevision:{...f.scope.contentRevision,extractorVersion:"old"}},{...f.execution,nodeId:f.document.toc[0].nodeId,maxChars:100})).rejects.toMatchObject({details:{reason:"CONTENT_REVISION_MISMATCH"}});
  });
  it("does not cancel a shared legacy extraction or cache a late cancelled consumer", async () => {
    const f=await fixture("spanning-node");
    let release!:()=>void,started!:()=>void;
    const barrier=new Promise<void>(done=>{release=done;}),entered=new Promise<void>(done=>{started=done;});
    const extractor={extractorVersion:f.extractor.extractorVersion,normalizationVersion:f.extractor.normalizationVersion,
      extract:jest.fn(async (_book,_bytes,_revision,execution)=>{
        if(!execution){started();await barrier;return f.document;}
        await new Promise<void>((_done,reject)=>execution.signal.addEventListener("abort",()=>reject(Error("worker aborted")),{once:true}));
        return f.document;
      })};
    const save=jest.fn(async()=>{}),loader=new BookDocumentLoader(f.source,extractor,{load:async()=>null,save});
    const legacy=loader.load(1,1);await entered;
    const controller=new AbortController(),cancelled=loader.load(1,1,{signal:controller.signal,deadline:Date.now()+30000});
    while(extractor.extract.mock.calls.length<2)await new Promise<void>(done=>setImmediate(done));
    controller.abort();await expect(cancelled).rejects.toMatchObject({details:{reason:"CONTENT_CANCELLED"}});
    expect(save).not.toHaveBeenCalled();release();expect(await legacy).toBe(f.document);
    expect(await loader.load(1,1)).toBe(f.document);expect(extractor.extract).toHaveBeenCalledTimes(2);expect(save).toHaveBeenCalledTimes(1);
  });
  it("discovers all 201 nodes through pages despite the tree limit", async () => {
    const f = await fixture("tree-limit");
    let cursor: string | undefined;
    const ids: string[] = [], sizes: number[] = [];
    do {
      const page = await f.service.discover(1, f.scope, { ...f.execution, cursor });
      expect(page.offset).toBe(ids.length);
      ids.push(...page.entries.map(n => n.nodeId)); sizes.push(page.entries.length);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(sizes).toEqual([100, 100, 1]);
    expect(new Set(ids).size).toBe(201);
  });
  it("keeps cross-section chapter attribution and exact canonical/raw/CFI evidence", async () => {
    const f = await fixture("spanning-node");
    const node = f.document.toc[0];
    const result = await f.service.readBatch(1, f.scope, { ...f.execution, nodeIds: [node.nodeId], maxChars: 50000 });
    expect(result.unavailable).toEqual([]);
    expect(result.candidates.map(e => e.sectionIndex)).toEqual([0, 1]);
    expect(structureAt(f.document, 1, 0)?.nodeId).toBe(node.nodeId);
    for (const e of result.candidates) {
      expect(e.locator.structure?.tocNodeId).toBe(node.nodeId);
      expect(e.cfi).toMatch(/^epubcfi/);
      expect(e.quoteHash).toBe(createHash("sha256").update(e.quote).digest("hex"));
      expect(e.quote).toBe(f.document.sections[e.sectionIndex].text.slice(e.start, e.end));
      expect(e.displayedQuote).toBeTruthy();
    }
    expect(result.nextCursor).toBeNull();
  });
  it("reads an oversized leaf in bounded continuations without pretending the rejected TOC batch read it", async () => {
    const f = await fixture("large-leaf");
    const nodeId = f.document.toc[0].nodeId;
    const batch = await f.service.readBatch(1, f.scope, { ...f.execution, nodeIds: [nodeId], maxChars: 50000 });
    expect(batch.candidates).toEqual([]);
    expect(batch.unavailable).toEqual(expect.arrayContaining([expect.objectContaining({ reason: "TOC_NODE_TOO_LARGE" })]));
    const coverage = new QaCoverage();
    let cursor: string | undefined, total = 0;
    do {
      const result = await f.service.readNode(1, f.scope, { ...f.execution, maxChars: 10000, ...(cursor ? { cursor } : { nodeId }) });
      expect(result.readChars).toBeLessThanOrEqual(10000);
      expect(result.unavailable).toEqual([]);
      result.targets.forEach(t => coverage.target(t.nodeId, t.ranges));
      result.candidates.forEach(e => coverage.record(e));
      total += result.readChars;
      cursor = result.nextCursor ?? undefined;
      if (cursor) expect(coverage.snapshot().targets[0].complete).toBe(false);
    } while (cursor);
    expect(total).toBe(f.document.toc[0].subtreeCharCount);
    expect(coverage.snapshot()).toMatchObject({ uniqueReadChars: total, targets: [{ complete: true }] });
  });
  it("refuses expired/cancelled/replaced requests before publishing evidence", async () => {
    const f = await fixture("spanning-node");
    await expect(f.service.discover(1, f.scope, { ...f.execution, deadline: 1 })).rejects.toMatchObject({ details: { reason: "INDEX_DEADLINE" } });
    const abort = new AbortController(); abort.abort();
    await expect(f.service.discover(1, f.scope, { ...f.execution, signal: abort.signal })).rejects.toMatchObject({ details: { reason: "CONTENT_CANCELLED" } });
    f.replace();
    await expect(f.service.discover(1, f.scope, f.execution)).rejects.toThrow("artifact replaced");
  });
});
