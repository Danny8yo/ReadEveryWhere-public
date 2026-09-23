import { createHash, randomUUID } from "node:crypto";
import {
  setImmediate as yieldTurn,
  setTimeout as wait,
} from "node:timers/promises";
import type { EpubEvidence } from "@readeverywhere/epub-core/node";
import { BOOK_MAX_EXPAND_CHARS, BOOK_MAX_EXPAND_SELECTED } from "../../public/book-retrieval.port";
import type {
  BookRetrievalPort,
  RetrievalScope,
  IndexState,
  VerifiedBookEvidence,
} from "../../public/book-retrieval.port";
import type { CurrentBookArtifactFencePort } from "../../public/current-book-artifact-fence.port";
import type { BookSelectionSourcePort } from "./ports/book-selection-source.port";
import type { BookDocumentExtractorPort } from "./ports/book-document-extractor.port";
import type {
  IndexIdentity,
  KeywordIndexRepository,
  KeywordIndexWorker,
  RankedChunk,
  IndexGeneration,
} from "./ports/keyword-index.port";
import { ReaderToolException } from "../domain/reader-tool-error";

export class BookRetrievalService implements BookRetrievalPort {
  private readonly tasks = new Map<
    string,
    { promise: Promise<void>; controller: AbortController }
  >();
  constructor(
    private readonly source: BookSelectionSourcePort,
    private readonly fence: CurrentBookArtifactFencePort,
    private readonly extractor: BookDocumentExtractorPort,
    private readonly worker: KeywordIndexWorker,
    private readonly repository: KeywordIndexRepository,
  ) {}
  onModuleInit() {
    this.repository.recoverInterrupted();
  }
  async onModuleDestroy() {
    for (const task of this.tasks.values())
      task.controller.abort(new Error("INDEX_INTERRUPTED: server stopping"));
    await Promise.all([...this.tasks.values()].map((t) => t.promise));
  }
  private identity(userId: number, scope: RetrievalScope): IndexIdentity {
    if (
      !Number.isSafeInteger(userId) ||
      userId <= 0 ||
      !Number.isSafeInteger(scope.bookId) ||
      scope.bookId <= 0 ||
      scope.artifact.bookId !== scope.bookId ||
      scope.artifact.fileChecksum !== scope.contentRevision.fileChecksum ||
      scope.contentRevision.extractorVersion !==
        this.extractor.extractorVersion ||
      scope.contentRevision.normalizationVersion !==
        this.extractor.normalizationVersion
    )
      throw new ReaderToolException(
        "CONTENT_REVISION_MISMATCH",
        "Index scope does not match the current parser/artifact",
      );
    this.fence.assertCurrent(userId, scope.artifact);
    const version = this.worker.version,
      key = createHash("sha256")
        .update(
          JSON.stringify([
            userId,
            scope.bookId,
            scope.artifact.artifactId,
            [
              scope.contentRevision.fileChecksum,
              scope.contentRevision.extractorVersion,
              scope.contentRevision.normalizationVersion,
            ],
            version.chunkerVersion,
            version.tokenizerVersion,
          ]),
        )
        .digest("hex");
    return { ...scope, userId, key, version };
  }
  private async bytes(i: IndexIdentity) {
    const file = await this.source.readOwnedEpubArtifact(i.userId, i.bookId);
    if (
      file.artifact.artifactId !== i.artifact.artifactId ||
      file.artifact.fileChecksum !== i.artifact.fileChecksum
    )
      throw new ReaderToolException(
        "CONTENT_REVISION_MISMATCH",
        "Index artifact changed while reading",
      );
    this.fence.assertCurrent(i.userId, i.artifact);
    return file.buffer;
  }
  private state(i: IndexIdentity, g: IndexGeneration): IndexState {
    if (g.state === "failed")
      throw new ReaderToolException(
        (g.error?.startsWith("INDEX_RESOURCE_LIMIT:") ? "INDEX_RESOURCE_LIMIT" : "INDEX_BUILD_FAILED"),
        g.error ?? "Index build failed",
      );
    return g.state === "ready"
      ? {
          state: "ready",
          generation: g.id,
          version: i.version,
          unavailable: g.unavailable,
        }
      : { state: "building", generation: g.id };
  }
  async ensureIndex(
    userId: number,
    scope: RetrievalScope,
    options: { rebuild?: boolean; retryFailed?: boolean } = {},
  ) {
    const i = this.identity(userId, scope),
      bytes = await this.bytes(i);
    const retryFailed = options.retryFailed === true && this.repository.latest(i)?.state === "failed";
    return this.ensure(i, bytes, options.rebuild === true || retryFailed);
  }
  private ensure(
    i: IndexIdentity,
    bytes: Buffer,
    rebuild: boolean,
  ): IndexState {
    const ready = this.repository.current(i);
    if (ready && !rebuild) return this.state(i, ready);
    const previous = this.repository.latest(i);
    if (previous && !rebuild) return this.state(i, previous);
    const owner = randomUUID(),
      begun = this.repository.begin(i, owner, rebuild),
      generation = begun.generation;
    if (begun.created) {
      const controller = new AbortController();
      const promise = Promise.resolve().then(async () => {
        try {
          const result = await this.worker.build(
            bytes,
            async (chunks) => {
              controller.signal.throwIfAborted();
              this.repository.append(i, generation.id, owner, chunks);
              await yieldTurn();
            },
            controller.signal,
          );
          controller.signal.throwIfAborted();
          this.repository.publish(i, generation.id, owner, result);
        } catch (error) {
          this.repository.fail(
            generation.id,
            owner,
            error instanceof Error ? error.message : String(error),
          );
        } finally {
          if (this.tasks.get(i.key)?.controller === controller)
            this.tasks.delete(i.key);
        }
      });
      this.tasks.set(i.key, { promise, controller });
    }
    return this.state(i, generation);
  }
  private deadline(deadline: number, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (
      !Number.isSafeInteger(deadline) ||
      deadline <= Date.now() ||
      deadline > Date.now() + 60_000
    )
      throw new ReaderToolException(
        "INDEX_DEADLINE",
        "Expected an active deadline no more than 60 seconds away",
      );
  }
  async retrieve(
    userId: number,
    input: Parameters<BookRetrievalPort["retrieve"]>[1],
  ) {
    this.deadline(input.deadline, input.signal);
    const limit = input.limit ?? 5;
    if (!Number.isInteger(limit) || limit < 1 || limit > 5)
      throw new ReaderToolException(
        "QUERY_INVALID",
        "Retrieval limit must be 1–5",
      );
    const maxChars = input.maxChars ?? 8000;
    if (!Number.isSafeInteger(maxChars) || maxChars < 1 || maxChars > 24000)
      throw new ReaderToolException("QUERY_INVALID", "Retrieval character budget must be 1–24000");
    const pool = await this.retrievalPool(userId, input);
    if (!pool.ready) return pool.state;
    const { i, bytes, state, selected, rawCandidateCount } = pool;
    const evidence = selected.length
      ? await this.worker.expand(
          bytes, i, selected,
          { maxChars, maxWindowChars: 2400, limit },
          input.deadline, input.signal,
        )
      : [];
    this.fence.assertCurrent(userId, i.artifact);
    if (evidence.length > limit || evidence.reduce((n, e) => n + e.quote.length, 0) > maxChars)
      throw new Error("Expanded evidence exceeds retrieval budget");
    const ranks = evidence.map((e) => {
      if (!e.hitRanges.length || e.end - e.start !== e.quote.length || e.quote.length > 2400)
        throw new Error("Invalid expanded evidence window");
      const indices = e.hitRanges.map((hit) => {
        const rank = selected.findIndex((c) => c.sectionIndex === hit.sectionIndex && c.start === hit.start && c.end === hit.end);
        if (rank < 0 || hit.sectionIndex !== e.sectionIndex || hit.start < e.start || hit.end > e.end)
          throw new Error("Expanded evidence does not contain its indexed hit");
        return rank;
      });
      return { evidence: e, rank: Math.min(...indices) };
    }).sort((a, b) => a.rank - b.rank);
    const candidates = ranks.map(({ evidence: e }) => this.evidence(i, e));
    this.deadline(input.deadline, input.signal);
    return {
      state: "ready" as const,
      generation: state.generation,
      version: state.version,
      candidates,
      rawCandidateCount,
      budgetLimited: evidence.length < limit && selected.some(c =>
        !evidence.some(e => e.sectionIndex === c.sectionIndex && e.start <= c.start && e.end >= c.end) &&
        c.end - c.start > maxChars - evidence.reduce((n, e) => n + e.quote.length, 0)),
      contextTruncated: evidence.some(e => e.contextTruncated),
      contextWindows: ranks.map(({ evidence: e }) => ({
        sectionIndex: e.sectionIndex, start: e.start, end: e.end,
        hitRanges: e.hitRanges, contextTruncated: e.contextTruncated,
      })),
      unavailable: state.unavailable,
    };
  }
  async searchCandidates(userId: number, input: Parameters<BookRetrievalPort["searchCandidates"]>[1]) {
    this.deadline(input.deadline, input.signal);
    const limit = input.limit ?? 20, maxChars = input.maxChars ?? 8000;
    if (!Number.isInteger(limit) || limit < 1 || limit > 20 ||
        !Number.isSafeInteger(maxChars) || maxChars < 1 || maxChars > 12000)
      throw new ReaderToolException("QUERY_INVALID", "Candidate limit must be 1–20 and character budget 1–12000");
    const pool = await this.retrievalPool(userId, input);
    if (!pool.ready) return pool.state;
    const { i, bytes, state, selected, rawCandidateCount } = pool;
    const admitted: RankedChunk[] = [];
    let remaining = maxChars, budgetLimited = false;
    for (const candidate of selected) {
      if (admitted.length >= limit) break;
      if (candidate.quote.length > remaining) { budgetLimited = true; continue; }
      admitted.push(candidate); remaining -= candidate.quote.length;
    }
    const replayed = admitted.length ? await this.worker.candidatesReplay(bytes, i, admitted, input.deadline, input.signal) : [];
    this.fence.assertCurrent(userId, i.artifact);
    if (replayed.length !== admitted.length) throw new Error("Candidate replay returned wrong count");
    const candidates = admitted.map(expected => {
      const actual = replayed.find(e => e.sectionIndex === expected.sectionIndex && e.start === expected.start && e.end === expected.end);
      if (!actual || actual.href !== expected.href || actual.cfi !== expected.cfi ||
          actual.quote !== expected.quote || actual.quoteHash !== expected.quoteHash || actual.displayedQuote !== expected.displayedQuote ||
          actual.end - actual.start !== actual.quote.length)
        throw new ReaderToolException("TEXT_QUOTE_MISMATCH", "Candidate differs from authoritative EPUB replay");
      return this.evidence(i, actual);
    });
    this.deadline(input.deadline, input.signal);
    return { ...state, candidates, rawCandidateCount, budgetLimited,
      contextTruncated: false,
      contextWindows: candidates.map(e => ({ sectionIndex: e.sectionIndex, start: e.start, end: e.end,
        hitRanges: [{ sectionIndex: e.sectionIndex, start: e.start, end: e.end }], contextTruncated: false })),
    };
  }
  async expandSelected(userId: number, input: Parameters<BookRetrievalPort["expandSelected"]>[1]) {
    this.deadline(input.deadline, input.signal);
    const maxWindowChars = input.maxWindowChars ?? 1600;
    if (!Array.isArray(input.evidence) || !input.evidence.length || input.evidence.length > BOOK_MAX_EXPAND_SELECTED ||
        !Number.isSafeInteger(input.maxChars) || input.maxChars < 1 || input.maxChars > BOOK_MAX_EXPAND_CHARS ||
        !Number.isSafeInteger(maxWindowChars) || maxWindowChars < 1 || maxWindowChars > 8000)
      throw new ReaderToolException("LOCATOR_INVALID", `Selected expansion requires 1–${BOOK_MAX_EXPAND_SELECTED} ranges and budgets of 1–${BOOK_MAX_EXPAND_CHARS} characters`);
    const i = this.identity(userId, input);
    this.validateEvidence(i, input.evidence);
    const bytes = await this.bytes(i);
    const expanded = await this.worker.expand(bytes, i, input.evidence,
      { maxChars: input.maxChars, maxWindowChars, limit: input.evidence.length, preserveAllHits: true }, input.deadline, input.signal);
    this.fence.assertCurrent(userId, i.artifact);
    if (expanded.length !== input.evidence.length || expanded.reduce((sum, e) => sum + e.quote.length, 0) > input.maxChars)
      throw new Error("Selected expansion lost evidence or exceeded its budget");
    const candidates = expanded.map((actual, rank) => {
      const hit = input.evidence[rank];
      if (actual.sectionIndex !== hit.sectionIndex || actual.href !== hit.href ||
          actual.start > hit.start || actual.end < hit.end || actual.end - actual.start !== actual.quote.length ||
          actual.quote.length > maxWindowChars || actual.hitRanges.length !== 1 ||
          actual.hitRanges[0].sectionIndex !== hit.sectionIndex || actual.hitRanges[0].start !== hit.start || actual.hitRanges[0].end !== hit.end)
        throw new Error("Selected expansion does not preserve its exact input hit");
      return this.evidence(i, actual);
    });
    this.deadline(input.deadline, input.signal);
    return { candidates, contextTruncated: expanded.some(e => e.contextTruncated),
      contextWindows: expanded.map(e => ({ sectionIndex: e.sectionIndex, start: e.start, end: e.end,
        hitRanges: e.hitRanges, contextTruncated: e.contextTruncated })),
    };
  }
  private async retrievalPool(userId: number, input: Parameters<BookRetrievalPort["searchCandidates"]>[1]) {
    const queries = this.worker.queries(input.queries),
      i = this.identity(userId, input),
      bytes = await this.bytes(i);
    this.deadline(input.deadline, input.signal);
    let state = this.ensure(i, bytes, false);
    while (state.state === "building" && Date.now() < input.deadline) {
      input.signal?.throwIfAborted();
      await wait(Math.min(25, input.deadline - Date.now()), undefined, {
        signal: input.signal,
      });
      const current = this.repository.current(i) ?? this.repository.latest(i);
      if (!current) throw new Error("Index generation disappeared");
      state = this.state(i, current);
    }
    if (state.state === "building") return { ready: false as const, state };
    this.deadline(input.deadline, input.signal);
    this.fence.assertCurrent(userId, i.artifact);
    const combined = new Map<number, { chunk: RankedChunk; rrf: number }>();
    let rawCandidateCount = 0;
    for (const tokens of queries) {
      const hits = this.repository.search(i, state.generation, tokens);
      rawCandidateCount += hits.length;
      hits.forEach((chunk, rank) => {
        const current = combined.get(chunk.id);
        if (current) current.rrf += 1 / (60 + rank + 1);
        else combined.set(chunk.id, { chunk, rrf: 1 / (60 + rank + 1) });
      });
    }
    const selected: RankedChunk[] = [];
    for (const { chunk } of [...combined.values()].sort(
      (a, b) => b.rrf - a.rrf || a.chunk.id - b.chunk.id,
    )) {
      if (
        selected.some(
          (c) =>
            c.sectionIndex === chunk.sectionIndex &&
            Math.max(
              0,
              Math.min(c.end, chunk.end) - Math.max(c.start, chunk.start),
            ) /
              Math.min(c.end - c.start, chunk.end - chunk.start) >=
              0.8,
        )
      )
        continue;
      selected.push(chunk);
      if (selected.length === 20) break;
    }
    return { ready: true as const, i, bytes, state, selected, rawCandidateCount };
  }
  private validateEvidence(i: IndexIdentity, evidence: VerifiedBookEvidence[]) {
    for (const e of evidence) {
      if (
        e.locator.version !== 1 ||
        e.locator.position.kind !== "epub_text" ||
        e.locator.bookId !== i.bookId ||
        e.locator.contentRevision.fileChecksum !==
          i.contentRevision.fileChecksum ||
        e.locator.contentRevision.extractorVersion !==
          i.contentRevision.extractorVersion ||
        e.locator.contentRevision.normalizationVersion !==
          i.contentRevision.normalizationVersion ||
        e.locator.position.sectionIndex !== e.sectionIndex ||
        e.locator.position.start !== e.start ||
        e.locator.position.end !== e.end ||
        !e.locator.structure ||
        !e.locator.readerAnchor ||
        !e.locator.textQuote ||
        e.locator.structure.href !== e.href ||
        e.locator.readerAnchor.epubcfi !== e.cfi ||
        e.locator.textQuote.exact !== e.quote
      )
        throw new ReaderToolException(
          "LOCATOR_INVALID",
          "Evidence locator scope/range differs",
        );
    }
  }
  private evidence(
    scope: RetrievalScope,
    e: EpubEvidence,
  ): VerifiedBookEvidence {
    return {
      ...(e.contextTruncated !== undefined ? { contextTruncated: e.contextTruncated } : {}),
      locator: {
        version: 1,
        bookId: scope.bookId,
        contentRevision: { ...scope.contentRevision },
        position: {
          kind: "epub_text",
          sectionIndex: e.sectionIndex,
          start: e.start,
          end: e.end,
        },
        structure: { href: e.href },
        readerAnchor: { epubcfi: e.cfi },
        textQuote: { exact: e.quote },
      },
      quote: e.quote,
      quoteHash: e.quoteHash,
      displayedQuote: e.displayedQuote,
      sectionIndex: e.sectionIndex,
      href: e.href,
      start: e.start,
      end: e.end,
      cfi: e.cfi,
    };
  }
  async readContext(
    userId: number,
    input: Parameters<BookRetrievalPort["readContext"]>[1],
  ) {
    this.deadline(input.deadline, input.signal);
    const i = this.identity(userId, input),
      bytes = await this.bytes(i),
      e = await this.worker.context(
        bytes,
        i,
        input,
        input.maxChars ?? 4000,
        input.deadline,
        input.signal,
      );
    this.fence.assertCurrent(userId, i.artifact);
    return this.evidence(i, e);
  }
  async replay(
    userId: number,
    input: Parameters<BookRetrievalPort["replay"]>[1],
  ) {
    this.deadline(input.deadline, input.signal);
    if (
      !Array.isArray(input.evidence) ||
      !input.evidence.length ||
      input.evidence.length > 5
    )
      throw new ReaderToolException(
        "LOCATOR_INVALID",
        "Replay accepts 1–5 evidence ranges",
      );
    const i = this.identity(userId, input),
      bytes = await this.bytes(i);
    this.validateEvidence(i, input.evidence);
    const result = await this.worker.replay(
      bytes,
      i,
      input.evidence,
      input.deadline,
      input.signal,
    );
    this.fence.assertCurrent(userId, i.artifact);
    if (result.length !== input.evidence.length)
      throw new ReaderToolException(
        "TEXT_QUOTE_MISMATCH",
        "Replay candidate count differs",
      );
    return input.evidence.map((expected) => {
      const actual = result.find(
        (e) =>
          e.sectionIndex === expected.sectionIndex &&
          e.start === expected.start &&
          e.end === expected.end,
      );
      if (
        !actual ||
        actual.href !== expected.href ||
        actual.cfi !== expected.cfi ||
        actual.quote !== expected.quote ||
        actual.quoteHash !== expected.quoteHash ||
        actual.displayedQuote !== expected.displayedQuote
      )
        throw new ReaderToolException(
          "TEXT_QUOTE_MISMATCH",
          "Evidence differs from authoritative EPUB replay",
        );
      return this.evidence(i, actual);
    });
  }
}
