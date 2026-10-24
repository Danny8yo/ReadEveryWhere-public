import type { BookStructuredContentPort, StructuredRange, StructuredRead } from "../../public/book-structured-content.port";
import type { BookRetrievalPort, RetrievalScope } from "../../public/book-retrieval.port";
import type { CurrentBookArtifactFencePort } from "../../public/current-book-artifact-fence.port";
import type { BookDocument, EpubBookLocatorV1 } from "../domain/book-document.types";
import { ReaderToolException } from "../domain/reader-tool-error";
import { BookDocumentLoader } from "./book-document.loader";
import { GetBookTocUseCase } from "./use-cases/get-book-toc.use-case";
import { ReadBookUseCase } from "./use-cases/read-book.use-case";
import { ReadBookFromTocUseCase } from "./use-cases/read-book-from-toc.use-case";
import { resolveTocNodeRange } from "./toc-node-range.resolver";
import { planTocRead } from "./toc-read-batch";
import { checkContentExecution, type ContentExecution } from "./ports/content-execution";
import { decodeCursor, encodeCursor, contentRevisionKey, makeLocator, structureAt } from "./reader-tool.utils";

/** Stateless structure planning and exact evidence bridge under a host-owned scope. */
export class BookStructuredContentService implements BookStructuredContentPort {
  constructor(private readonly documents: BookDocumentLoader, private readonly toc: GetBookTocUseCase,
    private readonly read: ReadBookUseCase, private readonly batches: ReadBookFromTocUseCase,
    private readonly retrieval: BookRetrievalPort, private readonly fence: CurrentBookArtifactFencePort) {}

  private async document(userId: number, scope: RetrievalScope, execution: ContentExecution) {
    checkContentExecution(execution);
    this.fence.assertCurrent(userId, scope.artifact);
    if (scope.artifact.bookId !== scope.bookId || scope.artifact.fileChecksum !== scope.contentRevision.fileChecksum)
      throw new ReaderToolException("CONTENT_REVISION_MISMATCH", "Structured scope differs from artifact");
    const document = await this.documents.load(userId, scope.bookId, execution);
    if (contentRevisionKey(document.revision) !== contentRevisionKey(scope.contentRevision))
      throw new ReaderToolException("CONTENT_REVISION_MISMATCH", "Structured document differs from scope");
    this.fence.assertCurrent(userId, scope.artifact);
    return document;
  }
  async discover(userId: number, scope: RetrievalScope, input: Parameters<BookStructuredContentPort["discover"]>[2]) {
    const document = await this.document(userId, scope, input);
    const page = await this.toc.execute(userId, scope.bookId, { mode: "outline", limit: 100, ...(input.cursor ? { cursor: input.cursor } : {}) }, input);
    checkContentExecution(input);
    this.fence.assertCurrent(userId, scope.artifact);
    return { contentRevision: document.revision, tocQuality: document.tocQuality, provenance: { ...document.tocProvenance },
      totalNodes: document.toc.length, offset: page.entries.length ? page.entries[0].linearIndex : document.toc.length,
      entries: page.entries.map(entry => {
        const range = resolveTocNodeRange(document, entry.nodeId);
        const node = range.node;
        return { nodeId: node.nodeId, parentNodeId: node.parentNodeId, linearIndex: node.linearIndex, level: node.level, label: node.label, path: node.path,
          ownCharCount: node.ownCharCount, subtreeCharCount: node.subtreeCharCount, hasChildren: node.hasChildren, start: { sectionIndex: range.startLocator.position.sectionIndex, offset: range.startLocator.position.start },
          end: { sectionIndex: range.endLocator.position.sectionIndex, offset: range.endLocator.position.end } };
      }), nextCursor: page.nextCursor };
  }
  private targets(document: BookDocument, nodeIds: string[]) {
    return nodeIds.map(nodeId => {
      const { startLocator, endLocator } = resolveTocNodeRange(document, nodeId);
      const first = startLocator.position, last = endLocator.position;
      return { nodeId, ranges: document.sections.filter(s => s.sectionIndex >= first.sectionIndex && s.sectionIndex <= last.sectionIndex)
        .map(s => ({ sectionIndex: s.sectionIndex, href: s.href, start: s.sectionIndex === first.sectionIndex ? first.start : 0,
          end: s.sectionIndex === last.sectionIndex ? last.end : s.text.length })).filter(r => r.end > r.start) };
    });
  }
  private budget(maxChars: number) {
    if (!Number.isSafeInteger(maxChars) || maxChars < 1 || maxChars > 50000) throw new ReaderToolException("LOCATOR_INVALID", "Invalid structured reading character allowance");
  }
  private async verify(userId: number, scope: RetrievalScope, document: BookDocument,
    raw: Awaited<ReturnType<ReadBookUseCase["execute"]>> | Awaited<ReturnType<ReadBookFromTocUseCase["execute"]>>, execution: ContentExecution) {
    const ranges: StructuredRange[] = raw.segments.map(segment => {
      const { sectionIndex, start, end } = segment.citation.locator.position;
      const section = document.sections.find(s => s.sectionIndex === sectionIndex);
      if (!section) throw new ReaderToolException("EXTRACTION_FAILED", "Structured segment has no section");
      // Preserve the deterministic reader's endpoints. Arbitrary character cuts
      // can fall inside normalized/NFC/synthetic source-map regions and turn an
      // otherwise representable chapter into artificial evidence gaps.
      return { sectionIndex, href: section.href, start, end };
    });
    if (ranges.length > 100) throw new ReaderToolException("INDEX_RESOURCE_LIMIT", "Too many evidence ranges in one structured batch");
    const result = ranges.length ? await this.retrieval.verifyRanges(userId, { ...scope, ...execution, deadline: Math.min(execution.deadline, Date.now() + 60000), ranges }) : { candidates: [], unavailable: [] };
    for (const e of result.candidates) {
      const section = document.sections.find(s => s.sectionIndex === e.sectionIndex);
      if (!section || section.text.slice(e.start, e.end) !== e.quote) throw new ReaderToolException("TEXT_QUOTE_MISMATCH", "Structured extraction and precise replay differ");
      const structure = structureAt(document, e.sectionIndex, e.start);
      e.locator.structure = { href: e.href, ...(structure ? { tocNodeId: structure.nodeId, label: structure.label, path: structure.path } : {}) };
    }
    checkContentExecution(execution);
    this.fence.assertCurrent(userId, scope.artifact);
    return result;
  }
  async readBatch(userId: number, scope: RetrievalScope, input: Parameters<BookStructuredContentPort["readBatch"]>[2]): Promise<StructuredRead> {
    this.budget(input.maxChars);
    const document = await this.document(userId, scope, input);
    const request = input.cursor ? { cursor: input.cursor } : { nodeIds: input.nodeIds };
    const plan = planTocRead(document, request);
    const targets = this.targets(document, plan.coverage.selectedNodeIds);
    if (plan.normalizedCharCount > input.maxChars)
      return { candidates: [], targets, unavailable: plan.unavailable, nextCursor: input.cursor ?? null, readChars: 0, notExecuted: "READ_BUDGET_EXHAUSTED" };
    const raw = await this.batches.execute(userId, scope.bookId, request, input);
    const verified = await this.verify(userId, scope, document, raw, input);
    return { ...verified, targets, unavailable: [...raw.unavailable, ...verified.unavailable], nextCursor: raw.continuation.next?.cursor ?? null, readChars: raw.text.length };
  }
  async readNode(userId: number, scope: RetrievalScope, input: Parameters<BookStructuredContentPort["readNode"]>[2]): Promise<StructuredRead> {
    this.budget(input.maxChars);
    if (Boolean(input.nodeId) === Boolean(input.cursor)) throw new ReaderToolException("TOC_REQUEST_INVALID", "Use nodeId or cursor");
    const document = await this.document(userId, scope, input);
    let nodeId = input.nodeId;
    let point: { sectionIndex: number; offset: number } | undefined;
    if (input.cursor) {
      const cursor = decodeCursor<{ nodeId: string; point: { sectionIndex: number; offset: number } }>(input.cursor, v =>
        v.tool === "structured_node" && v.bookId === scope.bookId && v.artifactId === scope.artifact.artifactId &&
        v.revision === contentRevisionKey(scope.contentRevision) && typeof v.nodeId === "string" && typeof v.point === "object" && v.point !== null);
      if (!cursor) throw new ReaderToolException("CURSOR_INVALID", "Stale structured reading cursor");
      nodeId = cursor.nodeId; point = cursor.point;
    }
    if (!nodeId) throw new ReaderToolException("TOC_REQUEST_INVALID", "Missing nodeId");
    const target = resolveTocNodeRange(document, nodeId);
    if (!target.readable) throw new ReaderToolException("TOC_NODE_NOT_READABLE", "Selected node is not readable");
    const start = target.startLocator.position, end = target.endLocator.position;
    if (point && (!Number.isSafeInteger(point.sectionIndex) || !Number.isSafeInteger(point.offset) ||
      point.sectionIndex < start.sectionIndex || point.sectionIndex > end.sectionIndex || point.offset < 0 ||
      (point.sectionIndex === start.sectionIndex && point.offset < start.start) || (point.sectionIndex === end.sectionIndex && point.offset >= end.end)))
      throw new ReaderToolException("CURSOR_INVALID", "Cursor lies outside selected chapter");
    const locator: EpubBookLocatorV1 = point ? makeLocator(document, point.sectionIndex, point.offset, point.offset) : target.startLocator;
    const raw = await this.read.execute(userId, { locator, endLocator: target.endLocator, direction: "forward", maxChars: input.maxChars }, input);
    const verified = await this.verify(userId, scope, document, raw, input);
    const next = raw.continuation.next;
    return { ...verified, targets: this.targets(document, [nodeId]), readChars: raw.text.length,
      nextCursor: next ? encodeCursor({ tool: "structured_node", bookId: scope.bookId, artifactId: scope.artifact.artifactId,
        revision: contentRevisionKey(scope.contentRevision), nodeId, point: { sectionIndex: next.locator.position.sectionIndex, offset: next.locator.position.end } }) : null };
  }
}
