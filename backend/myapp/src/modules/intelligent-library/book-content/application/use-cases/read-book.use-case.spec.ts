import type { BookDocument, EpubBookLocatorV1 } from "../../domain/book-document.types";
import { BookDocumentLoader } from "../book-document.loader";
import type { BookContentSourcePort } from "../ports/book-content-source.port";
import { ReadBookUseCase } from "./read-book.use-case";

describe("ReadBookUseCase", () => {
  const revision = {
    fileChecksum: "sha256:test",
    extractorVersion: "epub-extractor-v1",
    normalizationVersion: "epub-text-v1",
  };
  const book = {
    id: 42,
    title: "Reader Tool Test",
    authors: ["Test Author"],
  };
  const contentSource = {
    findOwnedBook: jest.fn(() => book),
  };
  const documentLoader = {
    load: jest.fn(),
  };
  let useCase: ReadBookUseCase;

  function documentWithSections(texts: string[]): BookDocument {
    return {
      bookId: 42,
      revision,
      tocQuality: "spine_fallback",
      tocProvenance: {
        source: "spine_fallback",
        positionStrategy: "spine_fallback",
        hierarchyStrategy: "spine_fallback",
        headingMappedNodeCount: 0,
        inferredParentCount: 0,
      },
      sections: texts.map((text, sectionIndex) => ({
        sectionIndex,
        href: `section-${sectionIndex}.xhtml`,
        text,
        charCount: text.length,
        anchors: {},
      })),
      toc: [],
    };
  }

  function locator(start: number, end: number, sectionIndex = 0): EpubBookLocatorV1 {
    return {
      version: 1,
      bookId: 42,
      contentRevision: revision,
      position: { kind: "epub_text", sectionIndex, start, end },
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    useCase = new ReadBookUseCase(
      contentSource as unknown as BookContentSourcePort,
      documentLoader as unknown as BookDocumentLoader,
    );
  });

  it("caps direct application calls at the 50,000-character server limit", async () => {
    documentLoader.load.mockResolvedValue(documentWithSections(["x".repeat(60_000)]));

    const result = await useCase.execute(1, {
      locator: locator(0, 0),
      direction: "forward",
      maxChars: 60_000,
    });

    expect(result.text).toHaveLength(50_000);
    expect(result).not.toHaveProperty("citation");
    expect(result.segments).toEqual([
      expect.objectContaining({
        textStart: 0,
        textEnd: 50_000,
        citation: expect.objectContaining({
          locator: expect.objectContaining({ position: expect.objectContaining({ start: 0, end: 50_000 }) }),
        }),
      }),
    ]);
    expect(result.reachedSectionStart).toBe(true);
    expect(result.reachedSectionEnd).toBe(false);
  });

  it.each([
    ["forward", "cdefgh", 12, 18],
    ["backward", "234567", 2, 8],
    ["around", "56789abcde", 5, 15],
  ] as const)(
    "returns the deterministic %s window without changing reading order",
    async (direction, expectedText, expectedStart, expectedEnd) => {
      documentLoader.load.mockResolvedValue(documentWithSections(["0123456789abcdefghij"]));

      const result = await useCase.execute(1, {
        locator: locator(8, 12),
        direction,
        maxChars: direction === "around" ? 10 : 6,
      });

      expect(result.text).toBe(expectedText);
      expect(result.segments[0].citation.locator.position).toEqual(expect.objectContaining({
        start: expectedStart,
        end: expectedEnd,
      }));
    },
  );

  it("reports section boundaries independently from book boundaries", async () => {
    documentLoader.load.mockResolvedValue(documentWithSections(["first", "middle", "last"]));

    const atSectionStart = await useCase.execute(1, {
      locator: locator(0, 0, 1),
      direction: "forward",
      maxChars: 3,
    });
    expect(atSectionStart).toEqual(expect.objectContaining({
      reachedSectionStart: true,
      reachedSectionEnd: false,
      reachedBookStart: false,
      reachedBookEnd: false,
    }));

    const atSectionEnd = await useCase.execute(1, {
      locator: locator(0, 0, 1),
      direction: "forward",
      maxChars: 100,
    });
    expect(atSectionEnd).toEqual(expect.objectContaining({
      reachedSectionStart: true,
      reachedSectionEnd: true,
      reachedBookStart: false,
      reachedBookEnd: true,
    }));
    expect(atSectionEnd.nextLocator).toBeNull();
  });

  it("returns a directly reusable forward continuation that preserves the target boundary", async () => {
    documentLoader.load.mockResolvedValue(documentWithSections(["0123456789abcdefghij"]));

    const first = await useCase.execute(1, {
      locator: locator(0, 0),
      endLocator: locator(12, 12),
      direction: "forward",
      maxChars: 6,
    });

    expect(first.text).toBe("012345");
    expect(first.continuation.next).toEqual({
      locator: expect.objectContaining({ position: expect.objectContaining({ start: 6, end: 6 }) }),
      endLocator: locator(12, 12),
      direction: "forward",
      maxChars: 6,
    });

    const second = await useCase.execute(1, first.continuation.next!);
    expect(second.text).toBe("6789ab");
    expect(second.continuation.next).toBeNull();
    expect(second.nextLocator).not.toBeNull();
  });

  it("returns a directly reusable backward continuation and stops at its target", async () => {
    documentLoader.load.mockResolvedValue(documentWithSections(["0123456789abcdefghij"]));

    const first = await useCase.execute(1, {
      locator: locator(18, 18),
      endLocator: locator(6, 6),
      direction: "backward",
      maxChars: 6,
    });
    expect(first.text).toBe("cdefgh");
    expect(first.continuation.previous).toEqual({
      locator: expect.objectContaining({ position: expect.objectContaining({ start: 12, end: 12 }) }),
      endLocator: locator(6, 6),
      direction: "backward",
      maxChars: 6,
    });

    const second = await useCase.execute(1, first.continuation.previous!);
    expect(second.text).toBe("6789ab");
    expect(second.continuation.previous).toBeNull();
  });

  it("reads forward across sections in one call without crossing the target", async () => {
    documentLoader.load.mockResolvedValue(documentWithSections(["abcdefghij", "klmnopqrst", "uvwxyz"]));

    const first = await useCase.execute(1, {
      locator: locator(0, 0, 0),
      endLocator: locator(6, 6, 1),
      direction: "forward",
      maxChars: 10,
    });
    expect(first.text).toBe("abcdefghij");
    expect(first.segments).toHaveLength(1);
    expect(first.continuation.next).toEqual({
      locator: expect.objectContaining({ position: { kind: "epub_text", sectionIndex: 1, start: 0, end: 0 } }),
      endLocator: locator(6, 6, 1),
      direction: "forward",
      maxChars: 10,
    });

    const complete = await useCase.execute(1, {
      locator: locator(0, 0, 0),
      endLocator: locator(6, 6, 1),
      direction: "forward",
      maxChars: 16,
    });
    expect(complete.text).toBe("abcdefghijklmnop");
    expect(complete.segments).toHaveLength(2);
    expect(complete.segments[1].citation.locator.position)
      .toEqual(expect.objectContaining({ sectionIndex: 1, start: 0, end: 6 }));
    expect(complete.continuation.next).toBeNull();
    expect(complete.nextLocator).not.toBeNull();
  });

  it("reads backward across sections in one call without changing reading order", async () => {
    documentLoader.load.mockResolvedValue(documentWithSections(["abcdefghij", "klmnopqrst", "uvwxyz"]));

    const first = await useCase.execute(1, {
      locator: locator(6, 6, 1),
      endLocator: locator(0, 0, 0),
      direction: "backward",
      maxChars: 10,
    });
    expect(first.text).toBe("ghijklmnop");
    expect(first.segments).toHaveLength(2);
    expect(first.continuation.previous).toEqual({
      locator: expect.objectContaining({ position: { kind: "epub_text", sectionIndex: 0, start: 6, end: 6 } }),
      endLocator: locator(0, 0, 0),
      direction: "backward",
      maxChars: 10,
    });

    const second = await useCase.execute(1, first.continuation.previous!);
    expect(second.text + first.text).toBe("abcdefghijklmnop");
    expect(second.continuation.previous).toBeNull();
  });

  it("rejects a continuation target from a stale content revision", async () => {
    documentLoader.load.mockResolvedValue(documentWithSections(["0123456789"]));

    await expect(useCase.execute(1, {
      locator: locator(0, 0),
      endLocator: {
        ...locator(8, 8),
        contentRevision: { ...revision, normalizationVersion: "epub-text-v2" },
      },
      direction: "forward",
      maxChars: 6,
    })).rejects.toMatchObject({
      details: { reason: "CONTENT_REVISION_MISMATCH", field: "endLocator.contentRevision" },
    });
  });

  it("rejects around reads combined with a target locator", async () => {
    documentLoader.load.mockResolvedValue(documentWithSections(["0123456789"]));

    await expect(useCase.execute(1, {
      locator: locator(4, 6),
      endLocator: locator(8, 8),
      direction: "around",
      maxChars: 6,
    })).rejects.toMatchObject({ details: { reason: "LOCATOR_INVALID", field: "endLocator" } });
  });

  it("returns a recoverable error when the requested target has already been reached", async () => {
    documentLoader.load.mockResolvedValue(documentWithSections(["0123456789"]));

    await expect(useCase.execute(1, {
      locator: locator(6, 6),
      endLocator: locator(6, 6),
      direction: "forward",
      maxChars: 200,
    })).rejects.toMatchObject({
      status: 409,
      code: 40915,
      details: { reason: "READING_TARGET_ALREADY_REACHED", field: "endLocator" },
    });
  });
});
