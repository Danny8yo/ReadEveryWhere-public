import {
  BookRetrievalPort,
  RetrievalScope,
} from "../../../intelligent-library/public/book-retrieval.port";
import {
  QaBookPort,
  QaEvidence,
} from "../application/selection-qa-runtime.port";
import { SelectionSnapshot } from "../application/selection-qa.types";
export class SelectionQaBooksAdapter implements QaBookPort {
  constructor(private readonly books: BookRetrievalPort) {}
  index(userId: number, s: SelectionSnapshot) {
    return this.books.ensureIndex(userId, this.scope(s), { retryFailed: true });
  }
  private scope(selection: SelectionSnapshot): RetrievalScope {
    return {
      bookId: selection.scope.bookId,
      artifact: selection.artifact,
      contentRevision: {
        fileChecksum: selection.scope.fileChecksum,
        extractorVersion: selection.scope.extractorVersion,
        normalizationVersion: selection.scope.normalizationVersion,
      },
    };
  }
  context(
    userId: number,
    s: SelectionSnapshot,
    input: Parameters<QaBookPort["context"]>[2],
  ) {
    return this.books.readContext(userId, { ...this.scope(s), ...input, deadline: Math.min(input.deadline, Date.now() + 60_000) });
  }
  searchCandidates(
    userId: number,
    s: SelectionSnapshot,
    input: Parameters<QaBookPort["searchCandidates"]>[2],
  ) {
    return this.books.searchCandidates(userId, { ...this.scope(s), ...input, deadline: Math.min(input.deadline, Date.now() + 60_000) });
  }
  async searchPool(
    userId: number,
    s: SelectionSnapshot,
    input: Parameters<QaBookPort["searchPool"]>[2],
  ) {
    const result = await this.books.searchPool(userId, { ...this.scope(s), ...input, deadline: Math.min(input.deadline, Date.now() + 60_000) });
    if (result.state !== "ready") return result;
    return { state: "ready" as const, candidates: result.candidates, unavailable: result.unavailable, lists: result.lists,
      pipeline: { tokenizerVersion: result.version.tokenizerVersion, queryPolicyVersion: result.version.queryPolicyVersion } };
  }
  verifyCandidates(
    userId: number,
    s: SelectionSnapshot,
    input: Parameters<QaBookPort["verifyCandidates"]>[2],
  ) {
    return this.books.verifyCandidates(userId, { ...this.scope(s), ...input, deadline: Math.min(input.deadline, Date.now() + 60_000) });
  }
  expandSelected(
    userId: number,
    s: SelectionSnapshot,
    input: Parameters<QaBookPort["expandSelected"]>[2],
  ) {
    return this.books.expandSelected(userId, { ...this.scope(s), ...input, deadline: Math.min(input.deadline, Date.now() + 60_000) });
  }
  replay(
    userId: number,
    s: SelectionSnapshot,
    evidence: QaEvidence[],
    deadline: number,
    signal: AbortSignal,
  ) {
    return this.books.replay(userId, {
      ...this.scope(s),
      evidence,
      deadline: Math.min(deadline, Date.now() + 60_000),
      signal,
    });
  }
}
