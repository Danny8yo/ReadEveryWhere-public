import { EPUB_EXTRACTOR_VERSION } from "@readeverywhere/epub-core";
import type { BookDocument } from "../../domain/book-document.types";
import {
  EPUB_NORMALIZATION_VERSION,
  EpubDocumentExtractor,
} from "../../infrastructure/epub-document.extractor";
import { inspectorEpubFixtures } from "../../../../../../tools/book-document-inspector/fixtures/epub-fixtures";
import { BookDocumentLoader } from "../book-document.loader";
import type { BookContentSourcePort } from "../ports/book-content-source.port";
import { ReadBookFromTocUseCase } from "./read-book-from-toc.use-case";
import { ReadBookUseCase } from "./read-book.use-case";
import { ResolveTocNodeReadTargetUseCase } from "./resolve-toc-node-read-target.use-case";

describe("ReadBookFromTocUseCase", () => {
  const document = fixtureDocument();
  const contentSource = {
    findOwnedBook: jest.fn(() => ({ id: 42, title: "Fixture", authors: [] })),
  } as unknown as BookContentSourcePort;
  const loader = { load: jest.fn().mockResolvedValue(document) } as unknown as BookDocumentLoader;
  const readBook = new ReadBookUseCase(contentSource, loader);
  const useCase = new ReadBookFromTocUseCase(loader, readBook);

  it("reads a selected parent node and its complete subtree without truncation", async () => {
    const result = await useCase.execute(1, 42, { nodeIds: ["chapter"] });

    expect(result.text).toBe("a".repeat(500) + "b".repeat(600));
    expect(result.units[0]).toMatchObject({
      nodeId: "chapter",
      label: "Chapter",
      normalizedCharCount: 1_100,
      complete: true,
    });
    expect(result).not.toHaveProperty("citation");
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0].citation.evidenceType).toBe("read_context");
    expect(result.segments[0].citation.chapterPath).toBe("Chapter");
    expect(result.continuation.next).toBeNull();
  });

  it.each([49_999, 50_000, 50_001])("enforces the complete-node limit at %i characters", async (size) => {
    const largeDocument = fixtureDocument();
    largeDocument.sections = [{
      sectionIndex: 0, href: "large.xhtml", text: "x".repeat(size), charCount: size, anchors: {},
    }];
    largeDocument.toc = [{
      ...largeDocument.toc[0], sectionIndex: 0, start: 0, endSectionIndex: 0, end: size,
      ownCharCount: size, subtreeCharCount: size, hasChildren: false,
    }];
    const largeLoader = { load: jest.fn().mockResolvedValue(largeDocument) } as unknown as BookDocumentLoader;
    const largeRead = new ReadBookUseCase(contentSource, largeLoader);
    const largeUseCase = new ReadBookFromTocUseCase(
      largeLoader,
      largeRead,
    );

    if (size <= 50_000) {
      const result = await largeUseCase.execute(1, 42, { nodeIds: ["chapter"] });
      expect(result.text).toHaveLength(size);
      expect(result.coverage.complete).toBe(true);
      return;
    }
    const result = await largeUseCase.execute(1, 42, { nodeIds: ["chapter"] });
    expect(result.text).toBe("");
    expect(result.segments).toEqual([]);
    expect(result.unavailable).toEqual([expect.objectContaining({
      nodeId: "chapter", reason: "TOC_NODE_TOO_LARGE", normalizedCharCount: size,
    })]);
    expect(result.coverage.complete).toBe(false);
    expect(result).not.toHaveProperty("recovery");
  });

  it("rejects missing nodes and reports empty units", async () => {
    await expect(useCase.execute(1, 42, { nodeIds: ["missing"] }))
      .rejects.toMatchObject({ details: { reason: "TOC_NODE_NOT_FOUND", field: "nodeIds" } });
    const result = await useCase.execute(1, 42, { nodeIds: ["empty"] });
    expect(result.unavailable[0].reason).toBe("TOC_NODE_NOT_READABLE");
    expect(result.coverage.complete).toBe(false);
  });

  describe("with a heading-inferred TOC", () => {
    const epubFixture = inspectorEpubFixtures.find((item) => item.id === "read-boundary-tree")!;
    let inferredDocument: Awaited<ReturnType<EpubDocumentExtractor["extract"]>>;
    beforeAll(async () => { inferredDocument = await new EpubDocumentExtractor().extract(42, epubFixture.epub, {
      fileChecksum: "sha256:read-boundary-tree",
      extractorVersion: EPUB_EXTRACTOR_VERSION,
      normalizationVersion: EPUB_NORMALIZATION_VERSION,
    }); });
    const inferredLoader = { load: jest.fn().mockImplementation(async () => inferredDocument) } as unknown as BookDocumentLoader;
    const inferredReadBook = new ReadBookUseCase(contentSource, inferredLoader);
    const inferredUseCase = new ReadBookFromTocUseCase(
      inferredLoader,
      inferredReadBook,
    );

    it("reads a chapter and its descendants without crossing into the next sibling", async () => {
      const chapter = inferredDocument.toc.find((node) => node.label === "第一章")!;
      const nextChapter = inferredDocument.toc.find((node) => node.label === "第二章")!;
      expect(chapter.parentNodeId).not.toBeNull();
      expect(chapter.endSectionIndex).toBe(nextChapter.sectionIndex);
      expect(chapter.end).toBe(nextChapter.start);

      const first = await inferredUseCase.execute(1, 42, { nodeIds: [chapter.nodeId] });
      expect(first.segments[0].citation.locator.position).toEqual({
        kind: "epub_text",
        sectionIndex: chapter.sectionIndex,
        start: chapter.start,
        end: first.segments[0].citation.locator.position.end,
      });
      expect(first.text).toBe(nodeText(inferredDocument, chapter));
      expect(first.text).not.toContain(inferredDocument.sections[nextChapter.sectionIndex].text);
      expect(first.continuation.next).toBeNull();
    });

    it("uses the inferred Part subtree end and rejects a v3 continuation", async () => {
      const part = inferredDocument.toc.find((node) => node.label === "第一部")!;
      const nextPart = inferredDocument.toc.find((node) => node.label === "第二部")!;
      await inferredUseCase.execute(1, 42, { nodeIds: [part.nodeId] });
      const target = await new ResolveTocNodeReadTargetUseCase(inferredLoader).execute(1, 42, { nodeId: part.nodeId });
      expect(globalPosition(inferredDocument, target.endLocator.position)).toBe(globalPosition(inferredDocument, {
        sectionIndex: nextPart.sectionIndex,
        start: nextPart.start,
      }));

      const stale = structuredClone(target);
      stale.locator.contentRevision.extractorVersion = "epub-extractor-v3";
      stale.endLocator.contentRevision.extractorVersion = "epub-extractor-v3";
      await expect(inferredReadBook.execute(1, stale)).rejects.toMatchObject({
        details: { reason: "CONTENT_REVISION_MISMATCH" },
      });
    });
  });
});

function nodeText(document: BookDocument, node: BookDocument["toc"][number]): string {
  return document.sections
    .filter((section) => (
      section.sectionIndex >= node.sectionIndex
      && section.sectionIndex <= (node.endSectionIndex ?? node.sectionIndex)
    ))
    .map((section) => section.text.slice(
      section.sectionIndex === node.sectionIndex ? node.start : 0,
      section.sectionIndex === node.endSectionIndex ? node.end : section.text.length,
    ))
    .join("");
}

function globalPosition(
  document: BookDocument,
  position: { sectionIndex: number; start: number },
): number {
  return document.sections
    .filter((section) => section.sectionIndex < position.sectionIndex)
    .reduce((total, section) => total + section.text.length, 0)
    + position.start;
}

function fixtureDocument(): BookDocument {
  return {
    bookId: 42,
    revision: {
      fileChecksum: "sha256:fixture",
      extractorVersion: "epub-extractor-v4",
      normalizationVersion: "epub-text-v1",
    },
    tocQuality: "declared",
    tocProvenance: {
      source: "epub_nav",
      positionStrategy: "declared",
      hierarchyStrategy: "declared",
      headingMappedNodeCount: 0,
      inferredParentCount: 0,
    },
    sections: [
      { sectionIndex: 0, href: "one.xhtml", text: "a".repeat(500), charCount: 500, anchors: {} },
      { sectionIndex: 1, href: "two.xhtml", text: "b".repeat(600), charCount: 600, anchors: {} },
      { sectionIndex: 2, href: "empty.xhtml", text: "", charCount: 0, anchors: {} },
    ],
    toc: [
      {
        nodeId: "chapter", parentNodeId: null, linearIndex: 0, level: 1, label: "Chapter", path: "Chapter",
        href: "one.xhtml", fragment: null, sectionIndex: 0, start: 0, endSectionIndex: 2, end: 0,
        ownCharCount: 500, subtreeCharCount: 1_100, hasChildren: true, sourceHeadingLevel: null,
      },
      {
        nodeId: "child", parentNodeId: "chapter", linearIndex: 1, level: 2, label: "Child", path: "Chapter > Child",
        href: "two.xhtml", fragment: null, sectionIndex: 1, start: 0, endSectionIndex: 2, end: 0,
        ownCharCount: 600, subtreeCharCount: 600, hasChildren: false, sourceHeadingLevel: null,
      },
      {
        nodeId: "empty", parentNodeId: null, linearIndex: 2, level: 1, label: "Empty", path: "Empty",
        href: "empty.xhtml", fragment: null, sectionIndex: 2, start: 0, endSectionIndex: 2, end: 0,
        ownCharCount: 0, subtreeCharCount: 0, hasChildren: false, sourceHeadingLevel: null,
      },
    ],
  };
}
