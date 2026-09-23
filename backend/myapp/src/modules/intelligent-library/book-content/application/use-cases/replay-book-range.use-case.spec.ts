import { createHash } from "node:crypto";
import type { BookDocument, ContentRevision, EpubBookLocatorV1 } from "../../domain/book-document.types";
import { BookDocumentLoader } from "../book-document.loader";
import type { BookContentSourcePort } from "../ports/book-content-source.port";
import { ReplayBookRangeUseCase } from "./replay-book-range.use-case";

describe("ReplayBookRangeUseCase", () => {
  const revision: ContentRevision = {
    fileChecksum: "sha256:replay",
    extractorVersion: "epub-extractor-v2",
    normalizationVersion: "epub-text-v1",
  };
  const book = { id: 42, title: "Replay Fixture", authors: ["Author"] };
  const contentSource = { findOwnedBook: jest.fn((_userId: number, _bookId: number) => book) };
  const loader = { load: jest.fn() };
  let useCase: ReplayBookRangeUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    useCase = new ReplayBookRangeUseCase(
      contentSource as unknown as BookContentSourcePort,
      loader as unknown as BookDocumentLoader,
    );
    loader.load.mockResolvedValue(document());
  });

  it("replays exactly the persisted locator range and returns verification data", async () => {
    const sourceLocator = locator(0, 7, 18, "quoted text");

    const result = await useCase.execute(7, {
      bookId: 42,
      contentRevision: revision,
      sourceLocator,
    });

    expect(contentSource.findOwnedBook).toHaveBeenCalledWith(7, 42);
    expect(loader.load).toHaveBeenCalledWith(7, 42);
    expect(result.text).toBe("quoted text");
    expect(result.sourceTextHash).toBe(createHash("sha256").update("quoted text", "utf8").digest("hex"));
    expect(result.citation).toEqual(expect.objectContaining({
      sourceKind: "book_text",
      evidenceType: "read_context",
      bookId: 42,
      chapterPath: "正文",
      quote: "quoted text",
      locator: expect.objectContaining({
        position: { kind: "epub_text", sectionIndex: 0, start: 7, end: 18 },
      }),
    }));
  });

  it("requires the trusted book scope to match the source locator", async () => {
    await expect(useCase.execute(7, {
      bookId: 43,
      contentRevision: revision,
      sourceLocator: locator(0, 7, 18),
    })).rejects.toMatchObject({ details: { reason: "LOCATOR_INVALID" } });

    await expect(useCase.execute(7, {
      bookId: 42,
      contentRevision: { ...revision, fileChecksum: "sha256:stale" },
      sourceLocator: locator(0, 7, 18),
    })).rejects.toMatchObject({ details: { reason: "CONTENT_REVISION_MISMATCH" } });
  });

  it("checks the current revision after loading the user-owned book", async () => {
    loader.load.mockResolvedValue({
      ...document(),
      revision: { ...revision, normalizationVersion: "epub-text-v2" },
    });

    await expect(useCase.execute(7, {
      bookId: 42,
      contentRevision: revision,
      sourceLocator: locator(0, 7, 18),
    })).rejects.toMatchObject({ details: { reason: "CONTENT_REVISION_MISMATCH" } });
  });

  it("rejects an out-of-range or empty source range", async () => {
    await expect(useCase.execute(7, {
      bookId: 42,
      contentRevision: revision,
      sourceLocator: locator(0, 0, 100),
    })).rejects.toMatchObject({ details: { reason: "LOCATOR_OUT_OF_RANGE" } });

    await expect(useCase.execute(7, {
      bookId: 42,
      contentRevision: revision,
      sourceLocator: locator(0, 3, 3),
    })).rejects.toMatchObject({ details: { reason: "LOCATOR_INVALID" } });
  });

  it("rejects a changed source when the persisted TextQuote no longer matches", async () => {
    await expect(useCase.execute(7, {
      bookId: 42,
      contentRevision: revision,
      sourceLocator: locator(0, 7, 18, "tampered"),
    })).rejects.toMatchObject({ details: { reason: "TEXT_QUOTE_MISMATCH" } });
  });

  it("does not allow one user to replay another user's book", async () => {
    contentSource.findOwnedBook.mockReturnValueOnce(null as any);

    await expect(useCase.execute(8, {
      bookId: 42,
      contentRevision: revision,
      sourceLocator: locator(0, 7, 18),
    })).rejects.toMatchObject({ details: { reason: "BOOK_NOT_FOUND" } });
    expect(loader.load).not.toHaveBeenCalled();
  });

  function document(): BookDocument {
    return {
      bookId: 42,
      revision,
      tocQuality: "declared",
      tocProvenance: {
        source: "epub_nav",
        positionStrategy: "declared",
        hierarchyStrategy: "flat",
        headingMappedNodeCount: 0,
        inferredParentCount: 0,
      },
      sections: [{
        sectionIndex: 0,
        href: "chapter.xhtml",
        text: "before quoted text after",
        charCount: 24,
        anchors: {},
      }],
      toc: [{
        nodeId: "chapter",
        parentNodeId: null,
        linearIndex: 0,
        level: 1,
        label: "正文",
        path: "正文",
        href: "chapter.xhtml",
        fragment: null,
        sectionIndex: 0,
        start: 0,
        endSectionIndex: 0,
        end: 24,
        ownCharCount: 24,
        subtreeCharCount: 24,
        hasChildren: false,
        sourceHeadingLevel: null,
      }],
    };
  }

  function locator(
    sectionIndex: number,
    start: number,
    end: number,
    exact?: string,
  ): EpubBookLocatorV1 {
    return {
      version: 1,
      bookId: 42,
      contentRevision: revision,
      position: { kind: "epub_text", sectionIndex, start, end },
      ...(exact ? { textQuote: { exact } } : {}),
    };
  }
});
