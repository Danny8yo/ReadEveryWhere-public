import type { BookContentSourcePort } from "../ports/book-content-source.port";
import { ReaderToolException } from "../../domain/reader-tool-error";
import { BookDocumentLoader } from "../book-document.loader";
import {
  contentRevisionKey,
  decodeCursor,
  encodeCursor,
  makeCitation,
  makeLocator,
  requireOwnedBook,
  structureAt,
} from "../reader-tool.utils";

interface SearchCursor {
  tool: "book_search_text";
  bookId: number;
  revision: string;
  query: string;
  offset: number;
}

export class SearchBookTextUseCase {
  constructor(
    private readonly source: BookContentSourcePort,
    private readonly documentLoader: BookDocumentLoader,
  ) {}

  async execute(userId: number, bookId: number, input: { query: string; cursor?: string; limit?: number }) {
    const normalizedQuery = this.normalizeQuery(input.query);
    if (!normalizedQuery) throw new ReaderToolException("QUERY_INVALID", "Search query is empty after normalization", "query");
    const book = this.source.findOwnedBook(userId, bookId);
    requireOwnedBook(book);
    const document = await this.documentLoader.load(userId, bookId);
    const foldedQuery = this.fold(normalizedQuery).text;

    let offset = 0;
    if (input.cursor) {
      const state = decodeCursor<SearchCursor>(input.cursor, (value) =>
        value.tool === "book_search_text"
        && value.bookId === bookId
        && value.revision === contentRevisionKey(document.revision)
        && value.query === normalizedQuery
        && Number.isInteger(value.offset)
        && Number(value.offset) >= 0,
      );
      if (!state) throw new ReaderToolException("CURSOR_INVALID", "Search cursor is invalid or stale", "cursor");
      offset = state.offset;
    }

    const limit = input.limit ?? 10;
    const hits: Array<Record<string, unknown>> = [];
    let resultIndex = 0;
    let hasMore = false;

    sections: for (const section of document.sections) {
      const folded = this.fold(section.text);
      let fromIndex = 0;
      while (fromIndex <= folded.text.length) {
        const foldedStart = folded.text.indexOf(foldedQuery, fromIndex);
        if (foldedStart < 0) break;
        const foldedEnd = foldedStart + foldedQuery.length;
        const start = folded.map[foldedStart] ?? 0;
        const end = foldedEnd >= folded.map.length
          ? section.text.length
          : folded.map[foldedEnd];

        if (resultIndex >= offset + limit) {
          hasMore = true;
          break sections;
        }
        if (resultIndex >= offset) {
          const matchedText = section.text.slice(start, end);
          const locator = makeLocator(document, section.sectionIndex, start, end, matchedText);
          hits.push({
            resultIndex,
            matchedText,
            snippet: section.text.slice(Math.max(0, start - 160), Math.min(section.text.length, end + 160)),
            chapterPath: structureAt(document, section.sectionIndex, start)?.path ?? null,
            citation: makeCitation(book, document, locator, "exact_match", matchedText),
          });
        }
        resultIndex += 1;
        fromIndex = Math.max(foldedEnd, foldedStart + 1);
      }
    }

    const nextOffset = offset + hits.length;
    return {
      bookId,
      contentRevision: document.revision,
      normalizedQuery,
      matchPolicy: "normalized_literal",
      casePolicy: "unicode_case_fold",
      resultOrder: "reading_order",
      hits,
      nextCursor: hasMore
        ? encodeCursor({ tool: "book_search_text", bookId, revision: contentRevisionKey(document.revision), query: normalizedQuery, offset: nextOffset })
        : null,
      hasMore,
    };
  }

  private normalizeQuery(query: string): string {
    return query.normalize("NFC")
      .replace(/\u00a0/gu, " ")
      .replace(/[\t\f\v ]+/gu, " ")
      .trim();
  }

  private fold(value: string): { text: string; map: number[] } {
    let text = "";
    const map: number[] = [];
    for (let offset = 0; offset < value.length;) {
      const codePoint = value.codePointAt(offset)!;
      const source = String.fromCodePoint(codePoint);
      const folded = source.toLocaleLowerCase("und");
      text += folded;
      for (let index = 0; index < folded.length; index += 1) map.push(offset);
      offset += source.length;
    }
    map.push(value.length);
    return { text, map };
  }
}
