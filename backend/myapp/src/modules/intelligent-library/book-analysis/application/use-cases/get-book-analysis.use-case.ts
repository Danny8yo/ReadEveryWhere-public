import { extname } from "node:path";
import type { BookAnalysisContentPort } from "../ports/book-analysis-content.port";
import type { BookAnalysisLibraryPort } from "../ports/book-analysis-library.port";
import type { BookAnalysisStorePort } from "../ports/book-analysis-store.port";

export class GetBookAnalysisUseCase {
  constructor(
    private readonly books: Pick<
      BookAnalysisLibraryPort,
      "requireOwned" | "findOwnedAnalysisSource"
    >,
    private readonly content: Pick<BookAnalysisContentPort, "currentRevision">,
    private readonly store: Pick<BookAnalysisStorePort, "getSnapshot">,
    private readonly options: { strategyVersion: string },
  ) {}

  async execute(userId: number, bookId: number) {
    this.books.requireOwned(userId, bookId);
    const source = this.books.findOwnedAnalysisSource(userId, bookId);
    if (!source?.fileName || source.downloadStatus && source.downloadStatus !== "completed") {
      return emptySnapshot(bookId, "not_analyzed");
    }
    if (source.mimeType !== "application/epub+zip"
      && extname(source.fileName).toLowerCase() !== ".epub") {
      return emptySnapshot(bookId, "unsupported");
    }
    const revision = await this.content.currentRevision(userId, bookId);
    return {
      bookId,
      ...this.store.getSnapshot(userId, bookId, revision, this.options.strategyVersion),
    };
  }
}

function emptySnapshot(bookId: number, status: "not_analyzed" | "unsupported") {
  return { bookId, status, stale: false, candidate: null, errorCode: null };
}
