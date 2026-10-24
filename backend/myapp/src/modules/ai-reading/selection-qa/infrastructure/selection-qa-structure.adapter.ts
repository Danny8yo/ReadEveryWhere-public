import type { BookStructuredContentPort } from "../../../intelligent-library/public/book-structured-content.port";
import type { QaStructuredBookPort } from "../application/qa-structured-book.port";
import type { SelectionSnapshot } from "../application/selection-qa.types";
export class SelectionQaStructureAdapter implements QaStructuredBookPort {
  constructor(private readonly books: BookStructuredContentPort) {}
  private scope(s: SelectionSnapshot) {
    return { bookId: s.scope.bookId, artifact: s.artifact, contentRevision: {
      fileChecksum: s.scope.fileChecksum, extractorVersion: s.scope.extractorVersion, normalizationVersion: s.scope.normalizationVersion,
    } };
  }
  discover(userId: number, selection: SelectionSnapshot, input: Parameters<QaStructuredBookPort["discover"]>[2]) {
    return this.books.discover(userId, this.scope(selection), { ...input, deadline: Math.min(input.deadline, Date.now() + 60000) });
  }
  readBatch(userId: number, selection: SelectionSnapshot, input: Parameters<QaStructuredBookPort["readBatch"]>[2]) {
    return this.books.readBatch(userId, this.scope(selection), { ...input, deadline: Math.min(input.deadline, Date.now() + 60000) });
  }
  readNode(userId: number, selection: SelectionSnapshot, input: Parameters<QaStructuredBookPort["readNode"]>[2]) {
    return this.books.readNode(userId, this.scope(selection), { ...input, deadline: Math.min(input.deadline, Date.now() + 60000) });
  }
}
