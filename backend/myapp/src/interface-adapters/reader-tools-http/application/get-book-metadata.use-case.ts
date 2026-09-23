import type {
  BookContentAccessPort,
  LibraryQueryPort,
} from "../../../modules/intelligent-library/public";
import type { AnnotationQueryPort } from "../../../modules/reading-state/public";
import { requireOwnedBook } from "../../../modules/intelligent-library/public";

export class GetBookMetadataUseCase {
  constructor(
    private readonly libraryQueries: LibraryQueryPort,
    private readonly bookContent: Pick<BookContentAccessPort, "loadDocument">,
    private readonly annotationQuery: AnnotationQueryPort,
  ) {}

  async execute(userId: number, bookId: number) {
    const book = this.libraryQueries.getOwnedBook({ userId, bookId });
    requireOwnedBook(book);
    const document = await this.bookContent.loadDocument(userId, bookId);
    const annotations = this.annotationQuery.listByBook({ userId, bookId });
    return {
      book: {
        bookId: book.id,
        title: book.title,
        authors: book.authors,
        isbn: book.isbn,
        publisher: book.publisher,
        publishYear: book.publishYear,
        format: "epub",
      },
      contentRevision: document.revision,
      contentStats: {
        sectionCount: document.sections.length,
        tocNodeCount: document.toc.length,
        tocQuality: document.tocQuality,
        treeAvailable: document.toc.length <= 200,
        charCount: document.sections.reduce((total, section) => total + section.text.length, 0),
      },
      capabilities: {
        toc: "ready",
        textSearch: "ready",
        semanticSearch: "not_configured",
        annotations: "ready",
      },
      annotationStats: {
        totalCount: annotations.length,
        withNoteCount: annotations.filter((annotation) => annotation.note !== null).length,
      },
    };
  }
}
