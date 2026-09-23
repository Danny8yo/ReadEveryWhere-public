import type { BookDocument, ContentRevision, EpubBookLocatorV1 } from "../../domain/book-document.types";
import { BookDocumentLoader } from "../book-document.loader";
import { ResolveReaderFocusUseCase } from "./resolve-reader-focus.use-case";

describe("ResolveReaderFocusUseCase", () => {
  const revision: ContentRevision = {
    fileChecksum: "sha256:focus",
    extractorVersion: "epub-extractor-v2",
    normalizationVersion: "epub-text-v1",
  };
  const loader = { load: jest.fn() };
  let useCase: ResolveReaderFocusUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    useCase = new ResolveReaderFocusUseCase(loader as unknown as BookDocumentLoader);
  });

  it("resolves the most specific TOC range covering the reader section", async () => {
    loader.load.mockResolvedValue(document());

    const result = await useCase.execute(7, {
      bookId: 42,
      contentRevision: revision,
      readerFocus: { sectionIndex: 2, chapterLabel: "untrusted label" },
    });

    expect(loader.load).toHaveBeenCalledWith(7, 42);
    expect(result).toEqual(expect.objectContaining({
      sectionIndex: 2,
      tocNodeId: "chapter-1-1",
      chapterLabel: "第一节",
      chapterPath: "第一章 > 第一节",
      startLocator: expect.objectContaining({
        ...locator(2, 0),
        structure: expect.objectContaining({ href: "section-2.xhtml" }),
      }),
      endLocator: expect.objectContaining({
        ...locator(2, "section one".length),
        structure: expect.objectContaining({ href: "section-2.xhtml" }),
      }),
    }));
    expect(JSON.stringify(result)).not.toContain("untrusted label");
  });

  it("chooses a node that begins in the focused section before a wider ancestor", async () => {
    const value = document();
    value.toc.push({
      nodeId: "chapter-1-1-deep",
      parentNodeId: "chapter-1-1",
      linearIndex: 4,
      level: 3,
      label: "深入阅读",
      path: "第一章 > 第一节 > 深入阅读",
      href: "chapter-1-1.xhtml",
      fragment: "deep",
      sectionIndex: 2,
      start: 5,
      endSectionIndex: 3,
      end: 0,
      ownCharCount: 8,
      subtreeCharCount: 8,
      hasChildren: false,
      sourceHeadingLevel: null,
    });
    loader.load.mockResolvedValue(value);

    const result = await useCase.execute(7, {
      bookId: 42,
      contentRevision: revision,
      readerFocus: { sectionIndex: 2 },
    });

    expect(result.tocNodeId).toBe("chapter-1-1-deep");
    expect(result.startLocator.position).toEqual(expect.objectContaining({ start: 5, end: 5 }));
  });

  it("rejects a stale conversation revision", async () => {
    loader.load.mockResolvedValue(document());

    await expect(useCase.execute(7, {
      bookId: 42,
      contentRevision: { ...revision, fileChecksum: "sha256:stale" },
      readerFocus: { sectionIndex: 2 },
    })).rejects.toMatchObject({ details: { reason: "CONTENT_REVISION_MISMATCH" } });
  });

  it("rejects an unknown section instead of trusting the client chapter label", async () => {
    loader.load.mockResolvedValue(document());

    await expect(useCase.execute(7, {
      bookId: 42,
      contentRevision: revision,
      readerFocus: { sectionIndex: 99, chapterLabel: "第一章" },
    })).rejects.toMatchObject({ details: { reason: "REFERENCE_UNRESOLVED" } });
  });

  it("rejects a section that has no resolvable TOC range", async () => {
    const value = document();
    value.toc = value.toc.filter((node) => node.sectionIndex !== 4 && node.endSectionIndex !== 5);
    loader.load.mockResolvedValue(value);

    await expect(useCase.execute(7, {
      bookId: 42,
      contentRevision: revision,
      readerFocus: { sectionIndex: 4 },
    })).rejects.toMatchObject({ details: { reason: "REFERENCE_UNRESOLVED" } });
  });

  function document(): BookDocument {
    const sections = ["front", "chapter one", "section one", "section two", "appendix"]
      .map((text, sectionIndex) => ({
        sectionIndex,
        href: `section-${sectionIndex}.xhtml`,
        text,
        charCount: text.length,
        anchors: {},
      }));
    return {
      bookId: 42,
      revision,
      tocQuality: "declared",
      tocProvenance: {
        source: "epub_nav",
        positionStrategy: "declared",
        hierarchyStrategy: "declared",
        headingMappedNodeCount: 0,
        inferredParentCount: 0,
      },
      sections,
      toc: [
        tocNode("front", null, 0, 1, "前言", "前言", 0, 0, 1, 0),
        tocNode("chapter-1", null, 1, 1, "第一章", "第一章", 1, 0, 4, 0),
        tocNode("chapter-1-1", "chapter-1", 2, 2, "第一节", "第一章 > 第一节", 2, 0, 3, 0),
        tocNode("chapter-1-2", "chapter-1", 3, 2, "第二节", "第一章 > 第二节", 3, 0, 4, 0),
        tocNode("appendix", null, 4, 1, "附录", "附录", 4, 0, 4, sections[4].text.length),
      ],
    };
  }

  function tocNode(
    nodeId: string,
    parentNodeId: string | null,
    linearIndex: number,
    level: number,
    label: string,
    path: string,
    sectionIndex: number,
    start: number,
    endSectionIndex: number,
    end: number,
  ) {
    return {
      nodeId,
      parentNodeId,
      linearIndex,
      level,
      label,
      path,
      href: `section-${sectionIndex}.xhtml`,
      fragment: null,
      sectionIndex,
      start,
      endSectionIndex,
      end,
      ownCharCount: 1,
      subtreeCharCount: 1,
      hasChildren: false,
      sourceHeadingLevel: null,
    };
  }

  function locator(sectionIndex: number, offset: number): EpubBookLocatorV1 {
    return {
      version: 1,
      bookId: 42,
      contentRevision: revision,
      position: { kind: "epub_text", sectionIndex, start: offset, end: offset },
      structure: { href: `section-${sectionIndex}.xhtml` },
    };
  }
});
