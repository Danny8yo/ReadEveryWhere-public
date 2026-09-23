import type { BookContentSourcePort } from "../ports/book-content-source.port";
import type { BookDocument, EpubBookLocatorV1 } from "../../domain/book-document.types";
import { ReaderToolException } from "../../domain/reader-tool-error";
import { BookDocumentLoader } from "../book-document.loader";
import { compareBookPoint, readContinuousBookRange } from "../continuous-book-range.reader";
import { makeCitation, makeLocator, requireOwnedBook, revisionsEqual } from "../reader-tool.utils";

export const MAX_BOOK_READ_CHARACTERS = 50_000;

export class ReadBookUseCase {
  constructor(
    private readonly source: BookContentSourcePort,
    private readonly documentLoader: BookDocumentLoader,
  ) {}

  async execute(
    userId: number,
    input: {
      locator: EpubBookLocatorV1;
      endLocator?: EpubBookLocatorV1;
      direction?: "forward" | "backward" | "around";
      maxChars?: number;
    },
  ) {
    const locator = input.locator;
    const book = this.source.findOwnedBook(userId, locator.bookId);
    requireOwnedBook(book, "locator.bookId");
    const document = await this.documentLoader.load(userId, locator.bookId);
    this.validateLocator(locator, document, "locator");

    const direction = input.direction ?? "forward";
    const maxChars = Math.min(input.maxChars ?? 4_000, MAX_BOOK_READ_CHARACTERS);
    if (direction === "around" && locator.position.end - locator.position.start > maxChars) {
      throw new ReaderToolException("LOCATOR_INVALID", "Focused Locator range is larger than maxChars", "maxChars");
    }
    const target = input.endLocator
      ? this.validateTarget(input.endLocator, locator, document, direction)
      : undefined;
    const range = readContinuousBookRange({ document, locator, direction, maxChars, endLocator: target });

    let textOffset = 0;
    const segments = range.slices.map((item) => {
      const rangeLocator = makeLocator(document, item.section.sectionIndex, item.start, item.end);
      const { quote: _quote, ...citation } = makeCitation(book, document, rangeLocator, "read_context", item.text);
      const segment = { textStart: textOffset, textEnd: textOffset + item.text.length, citation };
      textOffset = segment.textEnd;
      return segment;
    });

    return {
      text: range.text,
      segments,
      previousLocator: range.previousLocator,
      nextLocator: range.nextLocator,
      reachedSectionStart: range.reachedSectionStart,
      reachedSectionEnd: range.reachedSectionEnd,
      reachedBookStart: range.reachedBookStart,
      reachedBookEnd: range.reachedBookEnd,
      continuation: {
        previous: this.continuationRequest("backward", range.previousLocator, direction, maxChars, target),
        next: this.continuationRequest("forward", range.nextLocator, direction, maxChars, target),
      },
      boundary: {
        sectionStart: range.reachedSectionStart,
        sectionEnd: range.reachedSectionEnd,
        bookStart: range.reachedBookStart,
        bookEnd: range.reachedBookEnd,
      },
    };
  }

  private validateLocator(
    locator: EpubBookLocatorV1,
    document: BookDocument,
    field: "locator" | "endLocator",
  ): void {
    if (locator.version !== 1 || locator.position.kind !== "epub_text") {
      throw new ReaderToolException("LOCATOR_INVALID", "Only EPUB text Locator version 1 is supported", field);
    }
    if (!revisionsEqual(locator.contentRevision, document)) {
      throw new ReaderToolException(
        "CONTENT_REVISION_MISMATCH",
        `${field} belongs to a different content revision`,
        `${field}.contentRevision`,
      );
    }
    const section = document.sections.find((candidate) => candidate.sectionIndex === locator.position.sectionIndex);
    const { start, end } = locator.position;
    if (!section || start < 0 || end < start || end > section.text.length) {
      throw new ReaderToolException("LOCATOR_OUT_OF_RANGE", `${field} is outside normalized section text`, `${field}.position`);
    }
    if (locator.textQuote?.exact) {
      const actual = section.text.slice(start, start + locator.textQuote.exact.length);
      if (actual !== locator.textQuote.exact) {
        throw new ReaderToolException("TEXT_QUOTE_MISMATCH", `${field} TextQuote does not match the current normalized text`, `${field}.textQuote`);
      }
    }
  }

  private validateTarget(
    target: EpubBookLocatorV1,
    locator: EpubBookLocatorV1,
    document: BookDocument,
    direction: "forward" | "backward" | "around",
  ): EpubBookLocatorV1 {
    if (direction === "around") {
      throw new ReaderToolException("LOCATOR_INVALID", "around reads cannot include endLocator", "endLocator");
    }
    if (target.bookId !== locator.bookId) {
      throw new ReaderToolException("LOCATOR_INVALID", "endLocator does not match the requested EPUB book", "endLocator");
    }
    this.validateLocator(target, document, "endLocator");
    const currentPoint = direction === "forward"
      ? { sectionIndex: locator.position.sectionIndex, offset: locator.position.end }
      : { sectionIndex: locator.position.sectionIndex, offset: locator.position.start };
    const targetPoint = direction === "forward"
      ? { sectionIndex: target.position.sectionIndex, offset: target.position.end }
      : { sectionIndex: target.position.sectionIndex, offset: target.position.start };
    const order = compareBookPoint(currentPoint, targetPoint);
    if (order === 0) {
      throw new ReaderToolException(
        "READING_TARGET_ALREADY_REACHED",
        "The requested reading target has already been reached",
        "endLocator",
      );
    }
    if ((direction === "forward" && order > 0) || (direction === "backward" && order < 0)) {
      throw new ReaderToolException("LOCATOR_INVALID", "endLocator is behind the requested reading direction", "endLocator");
    }
    return target;
  }

  private continuationRequest(
    requestDirection: "forward" | "backward",
    locator: EpubBookLocatorV1 | null,
    activeDirection: "forward" | "backward" | "around",
    maxChars: number,
    target?: EpubBookLocatorV1,
  ) {
    if (!locator) return null;
    if (activeDirection === requestDirection && target) {
      const locatorPoint = requestDirection === "forward"
        ? { sectionIndex: locator.position.sectionIndex, offset: locator.position.end }
        : { sectionIndex: locator.position.sectionIndex, offset: locator.position.start };
      const targetPoint = requestDirection === "forward"
        ? { sectionIndex: target.position.sectionIndex, offset: target.position.end }
        : { sectionIndex: target.position.sectionIndex, offset: target.position.start };
      const order = compareBookPoint(locatorPoint, targetPoint);
      if ((requestDirection === "forward" && order >= 0) || (requestDirection === "backward" && order <= 0)) return null;
      return { locator, endLocator: target, direction: requestDirection, maxChars } as const;
    }
    return { locator, direction: requestDirection, maxChars } as const;
  }
}
