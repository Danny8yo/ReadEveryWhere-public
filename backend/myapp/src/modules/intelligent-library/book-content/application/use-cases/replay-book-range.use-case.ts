import { createHash } from "node:crypto";
import type { BookContentSourcePort } from "../ports/book-content-source.port";
import type {
  ContentRevision,
  EpubBookLocatorV1,
} from "../../domain/book-document.types";
import { ReaderToolException } from "../../domain/reader-tool-error";
import { BookDocumentLoader } from "../book-document.loader";
import {
  makeCitation,
  makeLocator,
  requireOwnedBook,
  revisionsEqual,
} from "../reader-tool.utils";

export class ReplayBookRangeUseCase {
  constructor(
    private readonly source: BookContentSourcePort,
    private readonly documentLoader: BookDocumentLoader,
  ) {}

  async execute(
    userId: number,
    input: {
      bookId: number;
      contentRevision: ContentRevision;
      sourceLocator: EpubBookLocatorV1;
    },
  ) {
    const locator = input.sourceLocator;
    if (
      locator.version !== 1
      || locator.position.kind !== "epub_text"
      || locator.bookId !== input.bookId
    ) {
      throw new ReaderToolException(
        "LOCATOR_INVALID",
        "Source Locator does not match the requested book scope",
        "sourceLocator",
      );
    }
    if (!sameRevision(locator.contentRevision, input.contentRevision)) {
      throw new ReaderToolException(
        "CONTENT_REVISION_MISMATCH",
        "Source Locator belongs to a different content revision",
        "sourceLocator.contentRevision",
      );
    }

    const book = this.source.findOwnedBook(userId, input.bookId);
    requireOwnedBook(book, "bookId");
    const document = await this.documentLoader.load(userId, input.bookId);
    if (document.bookId !== input.bookId || !revisionsEqual(input.contentRevision, document)) {
      throw new ReaderToolException(
        "CONTENT_REVISION_MISMATCH",
        "Book content changed before the source range could be replayed",
        "contentRevision",
      );
    }

    const { sectionIndex, start, end } = locator.position;
    const section = document.sections.find((candidate) => candidate.sectionIndex === sectionIndex);
    if (
      !section
      || !Number.isSafeInteger(start)
      || !Number.isSafeInteger(end)
      || start < 0
      || end < start
      || end > section.text.length
    ) {
      throw new ReaderToolException(
        "LOCATOR_OUT_OF_RANGE",
        "Source Locator is outside normalized section text",
        "sourceLocator.position",
      );
    }
    if (end === start) {
      throw new ReaderToolException(
        "LOCATOR_INVALID",
        "Source Locator must identify a non-empty evidence range",
        "sourceLocator.position",
      );
    }

    const text = section.text.slice(start, end);
    if (locator.textQuote?.exact) {
      const actual = section.text.slice(start, start + locator.textQuote.exact.length);
      if (actual !== locator.textQuote.exact) {
        throw new ReaderToolException(
          "TEXT_QUOTE_MISMATCH",
          "Source Locator TextQuote does not match current normalized text",
          "sourceLocator.textQuote",
        );
      }
    }

    const replayedLocator = makeLocator(document, sectionIndex, start, end, text);
    return {
      text,
      sourceTextHash: createHash("sha256").update(text, "utf8").digest("hex"),
      citation: makeCitation(book, document, replayedLocator, "read_context", text),
    };
  }
}

function sameRevision(left: ContentRevision, right: ContentRevision): boolean {
  return left.fileChecksum === right.fileChecksum
    && left.extractorVersion === right.extractorVersion
    && left.normalizationVersion === right.normalizationVersion;
}
