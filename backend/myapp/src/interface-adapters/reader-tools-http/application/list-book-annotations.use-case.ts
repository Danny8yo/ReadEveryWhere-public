import type {
  AnnotationQueryPort,
  AnnotationQueryProjection,
  AnnotationQueryType,
} from "../../../modules/reading-state/public";
import type {
  BookContentAccessPort,
  BookDocument,
  LibraryQueryBookProjection,
  LibraryQueryPort,
} from "../../../modules/intelligent-library/public";
import {
  ReaderToolException,
  contentRevisionKey,
  decodeCursor,
  encodeCursor,
  makeCitation,
  makeLocator,
  requireOwnedBook,
} from "../../../modules/intelligent-library/public";

interface AnnotationCursor {
  tool: "book_list_annotations";
  bookId: number;
  revision: string;
  filterKey: string;
  offset: number;
}

const MAX_RESPONSE_CHARS = 20_000;

export class ListBookAnnotationsUseCase {
  constructor(
    private readonly libraryQueries: LibraryQueryPort,
    private readonly bookContent: Pick<BookContentAccessPort, "loadDocument">,
    private readonly annotationQuery: AnnotationQueryPort,
  ) {}

  async execute(
    userId: number,
    bookId: number,
    input: { cursor?: string; limit?: number; hasNote?: boolean; types?: AnnotationQueryType[] },
  ) {
    const book = this.libraryQueries.getOwnedBook({ userId, bookId });
    requireOwnedBook(book);
    const document = await this.bookContent.loadDocument(userId, bookId);
    const filterKey = JSON.stringify({
      hasNote: input.hasNote ?? null,
      types: input.types ? [...input.types].sort() : null,
    });
    let offset = 0;
    if (input.cursor) {
      const state = decodeCursor<AnnotationCursor>(input.cursor, (value) =>
        value.tool === "book_list_annotations"
        && value.bookId === bookId
        && value.revision === contentRevisionKey(document.revision)
        && value.filterKey === filterKey
        && Number.isInteger(value.offset)
        && Number(value.offset) >= 0,
      );
      if (!state) throw new ReaderToolException("CURSOR_INVALID", "Annotation cursor is invalid or stale", "cursor");
      offset = state.offset;
    }

    const filtered = this.annotationQuery.listByBook({ userId, bookId })
      .filter((annotation) => input.hasNote === undefined || (annotation.note !== null) === input.hasNote)
      .filter((annotation) => !input.types || input.types.includes(annotation.annotationType));

    const limit = input.limit ?? 20;
    const items: Array<Record<string, unknown>> = [];
    let responseChars = 0;
    let index = offset;
    while (index < filtered.length && items.length < limit) {
      const item = this.toView(book, document, filtered[index]);
      const itemChars = JSON.stringify(item).length;
      if (items.length > 0 && responseChars + itemChars > MAX_RESPONSE_CHARS) break;
      items.push(item);
      responseChars += itemChars;
      index += 1;
    }

    const hasMore = index < filtered.length;
    return {
      bookId,
      contentRevision: document.revision,
      items,
      nextCursor: hasMore
        ? encodeCursor({
            tool: "book_list_annotations",
            bookId,
            revision: contentRevisionKey(document.revision),
            filterKey,
            offset: index,
          })
        : null,
      hasMore,
      responseCharCount: responseChars,
    };
  }

  private toView(
    book: LibraryQueryBookProjection,
    document: BookDocument,
    annotation: AnnotationQueryProjection,
  ): Record<string, unknown> {
    const section = annotation.sectionIndex === null
      ? null
      : document.sections.find((candidate) => candidate.sectionIndex === annotation.sectionIndex) ?? null;
    const start = annotation.textPositionStart;
    const end = annotation.textPositionEnd;
    const checksum = document.revision.fileChecksum.replace(/^sha256:/u, "");
    const sameRevision = annotation.bookHash === document.revision.fileChecksum
      || annotation.bookHash === checksum;
    const validPosition = section
      && start !== null
      && end !== null
      && start >= 0
      && end >= start
      && end <= section.text.length;
    const quoteMatches = validPosition
      && section.text.slice(start!, end!) === annotation.textContent;
    const reanchoredStart = sameRevision && section && !quoteMatches
      ? this.findQuotePosition(
          section.text,
          annotation.textContent,
          annotation.contextBefore,
          annotation.contextAfter,
        )
      : null;

    if (sameRevision && section && (quoteMatches || reanchoredStart !== null)) {
      const exactStart = quoteMatches ? start! : reanchoredStart!;
      const exactEnd = quoteMatches ? end! : exactStart + annotation.textContent.length;
      const locator = makeLocator(document, section.sectionIndex, exactStart, exactEnd, annotation.textContent);
      return {
        ...this.baseView(annotation),
        location: {
          quality: "exact",
          locator,
          reanchorHint: null,
          warnings: quoteMatches ? [] : ["TextPosition was restored from the annotation TextQuote."],
        },
        citation: makeCitation(
          book,
          document,
          locator,
          "user_annotation",
          annotation.textContent,
          "user_annotation",
          annotation.id,
        ),
      };
    }

    const epubcfi = annotation.locationType === "epubcfi" && annotation.location.startsWith("epubcfi(")
      ? annotation.location
      : null;
    const canReanchor = Boolean(annotation.textContent);
    const quality = canReanchor ? "reanchorable" : epubcfi ? "reader_anchor_only" : "unresolved";
    const warnings = [
      sameRevision
        ? "The annotation has no verified UTF-16 TextPosition in the current content revision."
        : "The annotation is not tied to the current content revision.",
    ];
    return {
      ...this.baseView(annotation),
      location: {
        quality,
        locator: null,
        reanchorHint: quality === "unresolved"
          ? null
          : {
              contentRevision: sameRevision ? document.revision : null,
              sectionIndex: section?.sectionIndex ?? null,
              textQuote: canReanchor
                ? {
                    exact: annotation.textContent.slice(0, 5000),
                    prefix: annotation.contextBefore?.slice(-500) ?? undefined,
                    suffix: annotation.contextAfter?.slice(0, 500) ?? undefined,
                  }
                : null,
              epubcfi,
            },
        warnings,
      },
      citation: null,
    };
  }

  private findQuotePosition(
    text: string,
    exact: string,
    prefix: string | null,
    suffix: string | null,
  ): number | null {
    if (!exact) return null;
    const candidates: number[] = [];
    let offset = 0;
    while (offset <= text.length) {
      const found = text.indexOf(exact, offset);
      if (found < 0) break;
      candidates.push(found);
      offset = found + Math.max(1, exact.length);
    }
    if (candidates.length === 1) return candidates[0];
    const contextual = candidates.filter((start) => {
      const beforeMatches = !prefix || text.slice(Math.max(0, start - prefix.length), start) === prefix;
      const end = start + exact.length;
      const afterMatches = !suffix || text.slice(end, end + suffix.length) === suffix;
      return beforeMatches && afterMatches;
    });
    return contextual.length === 1 ? contextual[0] : null;
  }

  private baseView(annotation: AnnotationQueryProjection) {
    return {
      annotationId: annotation.id,
      type: annotation.annotationType,
      selectedText: annotation.textContent.slice(0, 5000),
      note: annotation.note?.slice(0, 5000) ?? null,
      chapterLabel: annotation.chapterLabel,
      createdAt: new Date(annotation.createdAt).toISOString(),
      updatedAt: new Date(annotation.updatedAt).toISOString(),
    };
  }
}
