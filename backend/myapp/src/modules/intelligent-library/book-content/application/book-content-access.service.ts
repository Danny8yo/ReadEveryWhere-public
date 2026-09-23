import type { BookContentAccessPort } from "../../public/book-content-access.port";
import { BookDocumentLoader } from "./book-document.loader";
import { GetBookTocUseCase } from "./use-cases/get-book-toc.use-case";
import { ReadBookFromTocUseCase } from "./use-cases/read-book-from-toc.use-case";
import { ReadBookUseCase } from "./use-cases/read-book.use-case";
import { ReplayBookRangeUseCase } from "./use-cases/replay-book-range.use-case";
import { ResolveReaderFocusUseCase } from "./use-cases/resolve-reader-focus.use-case";
import { ResolveTocNodeReadTargetUseCase } from "./use-cases/resolve-toc-node-read-target.use-case";
import { SearchBookSemanticallyUseCase } from "./use-cases/search-book-semantically.use-case";
import { SearchBookTextUseCase } from "./use-cases/search-book-text.use-case";

export class BookContentAccessService implements BookContentAccessPort {
  constructor(
    private readonly documents: BookDocumentLoader,
    private readonly toc: GetBookTocUseCase,
    private readonly readBook: ReadBookUseCase,
    private readonly readToc: ReadBookFromTocUseCase,
    private readonly textSearch: SearchBookTextUseCase,
    private readonly semanticSearch: SearchBookSemanticallyUseCase,
    private readonly tocTarget: ResolveTocNodeReadTargetUseCase,
    private readonly readerFocus: ResolveReaderFocusUseCase,
    private readonly replay: ReplayBookRangeUseCase,
  ) {}

  loadDocument(userId: number, bookId: number) {
    return this.documents.load(userId, bookId);
  }

  getToc(userId: number, bookId: number, input: Parameters<GetBookTocUseCase["execute"]>[2]) {
    return this.toc.execute(userId, bookId, input);
  }

  read(userId: number, input: Parameters<ReadBookUseCase["execute"]>[1]) {
    return this.readBook.execute(userId, input);
  }

  readFromToc(userId: number, bookId: number, input: { nodeIds?: string[]; cursor?: string }) {
    return this.readToc.execute(userId, bookId, input);
  }

  planTocRead(userId: number, bookId: number, input: { nodeIds?: string[]; cursor?: string }) {
    return this.readToc.plan(userId, bookId, input);
  }

  searchText(userId: number, bookId: number, input: Parameters<SearchBookTextUseCase["execute"]>[2]) {
    return this.textSearch.execute(userId, bookId, input);
  }

  searchSemantically(userId: number, bookId: number) {
    return this.semanticSearch.execute(userId, bookId);
  }

  resolveTocNodeReadTarget(
    userId: number,
    bookId: number,
    input: Parameters<ResolveTocNodeReadTargetUseCase["execute"]>[2],
  ) {
    return this.tocTarget.execute(userId, bookId, input);
  }

  resolveReaderFocus(userId: number, input: Parameters<ResolveReaderFocusUseCase["execute"]>[1]) {
    return this.readerFocus.execute(userId, input);
  }

  replayRange(userId: number, input: Parameters<ReplayBookRangeUseCase["execute"]>[1]) {
    return this.replay.execute(userId, input);
  }
}
