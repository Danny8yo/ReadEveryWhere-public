import type { BookDocument } from "../../domain/book-document.types";
import { ModelToolResultPresenter } from "../../../../ai-reading/application/model-tool-result.presenter";
import { BookDocumentLoader } from "../book-document.loader";
import { ReadBookUseCase } from "./read-book.use-case";
import { GetBookTocUseCase } from "./get-book-toc.use-case";

describe("GetBookTocUseCase navigation", () => {
  it("returns a backward-readable endLocator and keeps it in the internal model projection", async () => {
    const document = spanningChapterDocument();
    const loader = { load: jest.fn().mockResolvedValue(document) } as unknown as BookDocumentLoader;
    const toc = new GetBookTocUseCase(loader);
    const result = await toc.execute(1, 42, { mode: "navigation", nodeIds: ["chapter-1"] });
    const projected = new ModelToolResultPresenter().present("book_toc_navigation", result) as any;

    expect(projected.entries[0]).toEqual({
      nodeId: "chapter-1",
      label: "Chapter One",
      startLocator: minimumLocator(0, 0),
      endLocator: minimumLocator(1, 600),
    });

    const readBook = new ReadBookUseCase(
      { findOwnedBook: jest.fn(() => ({ id: 42, title: "Fixture", authors: [] })) } as any,
      loader,
    );
    const tail = await readBook.execute(1, {
      locator: {
        ...projected.entries[0].endLocator,
        bookId: 42,
        contentRevision: document.revision,
      },
      direction: "backward",
      maxChars: 200,
    });
    expect(tail.text).toBe("b".repeat(200));
  });
});

function spanningChapterDocument(): BookDocument {
  const revision = {
    fileChecksum: "sha256:fixture",
    extractorVersion: "epub-extractor-v2",
    normalizationVersion: "epub-text-v1",
  };
  return {
    bookId: 42,
    revision,
    tocQuality: "declared_repaired",
    tocProvenance: {
      source: "ncx",
      positionStrategy: "repaired",
      hierarchyStrategy: "flat",
      headingMappedNodeCount: 0,
      inferredParentCount: 0,
    },
    sections: [
      { sectionIndex: 0, href: "one.xhtml", text: "a".repeat(500), charCount: 500, anchors: {} },
      { sectionIndex: 1, href: "two.xhtml", text: "b".repeat(600), charCount: 600, anchors: {} },
      { sectionIndex: 2, href: "tail.xhtml", text: "tail", charCount: 4, anchors: {} },
    ],
    toc: [{
      nodeId: "chapter-1",
      parentNodeId: null,
      linearIndex: 0,
      level: 1,
      label: "Chapter One",
      path: "Chapter One",
      href: "one.xhtml",
      fragment: null,
      sectionIndex: 0,
      start: 0,
      endSectionIndex: 2,
      end: 0,
      ownCharCount: 1_100,
      subtreeCharCount: 1_100,
      hasChildren: false,
      sourceHeadingLevel: null,
    }],
  };
}

function minimumLocator(sectionIndex: number, offset: number) {
  return {
    version: 1,
    position: { kind: "epub_text", sectionIndex, start: offset, end: offset },
  };
}
