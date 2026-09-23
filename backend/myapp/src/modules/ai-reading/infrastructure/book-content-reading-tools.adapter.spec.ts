import { BookScope } from "../domain";
import type { BookDocument } from "../../intelligent-library/public";
import { ReadBookUseCase } from "../../intelligent-library/book-content/application/use-cases/read-book.use-case";
import { parseToolArguments } from "../application/agent-tool.schemas";
import { ModelToolResultPresenter } from "../application/model-tool-result.presenter";
import { BookContentReadingToolsAdapter } from "./book-content-reading-tools.adapter";

describe("BookContentReadingToolsAdapter", () => {
  it("injects the trusted book and revision into a model-provided locator", async () => {
    const revision = {
      fileChecksum: "sha256:trusted",
      extractorVersion: "1",
      normalizationVersion: "1",
    };
    const bookContent = {
      read: jest.fn().mockResolvedValue({
        text: "trusted text",
        segments: [{
          textStart: 0,
          textEnd: 12,
          citation: { locator: { position: { sectionIndex: 2, start: 10, end: 20 } } },
        }],
      }),
    };
    const adapter = new BookContentReadingToolsAdapter(
      bookContent as any,
      { execute: jest.fn() } as any,
      { execute: jest.fn() } as any,
    );
    const scope = BookScope.create({
      userId: "7",
      bookId: "42",
      contentRevision: JSON.stringify(revision),
    });

    await adapter.execute(scope, "book_read", {
      locator: {
        version: 1,
        position: { kind: "epub_text", sectionIndex: 2, start: 10, end: 20 },
      },
      direction: "forward",
      maxChars: 500,
    });

    expect(bookContent.read).toHaveBeenCalledWith(7, expect.objectContaining({
      locator: expect.objectContaining({ bookId: 42, contentRevision: revision }),
    }));
  });

  it("accepts projected next and previous locators and successfully continues real book_read", async () => {
    const revision = {
      fileChecksum: "sha256:trusted",
      extractorVersion: "1",
      normalizationVersion: "1",
    };
    const text = `${"a".repeat(200)}${"b".repeat(200)}`;
    const document: BookDocument = {
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
      sections: [{ sectionIndex: 0, href: "chapter.xhtml", text, charCount: text.length, anchors: {} }],
      toc: [{
        nodeId: "chapter",
        parentNodeId: null,
        linearIndex: 0,
        level: 0,
        label: "Chapter",
        path: "Chapter",
        href: "chapter.xhtml",
        fragment: null,
        sectionIndex: 0,
        start: 0,
        ownCharCount: text.length,
        subtreeCharCount: text.length,
        hasChildren: false,
        sourceHeadingLevel: null,
      }],
    };
    const readBook = new ReadBookUseCase(
      { findOwnedBook: jest.fn(() => ({ id: 42, title: "Fixture", authors: [] })) } as any,
      { load: jest.fn().mockResolvedValue(document) } as any,
    );
    const adapter = new BookContentReadingToolsAdapter(
      { read: (userId: number, input: any) => readBook.execute(userId, input) } as any,
      { execute: jest.fn() } as any,
      { execute: jest.fn() } as any,
    );
    const scope = BookScope.create({
      userId: "7",
      bookId: "42",
      contentRevision: JSON.stringify(revision),
    });
    const presenter = new ModelToolResultPresenter();

    const first = await adapter.execute(scope, "book_read", {
      locator: { version: 1, position: { kind: "epub_text", sectionIndex: 0, start: 0, end: 0 } },
      direction: "forward",
      maxChars: 200,
    });
    const firstModelResult = presenter.present("book_read", first.output) as any;
    const nextArguments = parseToolArguments("book_read", firstModelResult.continuation.next) as any;
    const second = await adapter.execute(scope, "book_read", nextArguments);
    const secondModelResult = presenter.present("book_read", second.output) as any;
    const previousArguments = parseToolArguments("book_read", secondModelResult.continuation.previous) as any;
    const replayedPrevious = await adapter.execute(scope, "book_read", previousArguments);

    expect((first.output as any).text).toBe("a".repeat(200));
    expect((second.output as any).text).toBe("b".repeat(200));
    expect((replayedPrevious.output as any).text).toBe("a".repeat(200));
    expect(firstModelResult.continuation.next).toEqual({
      locator: {
        version: 1,
        position: { kind: "epub_text", sectionIndex: 0, start: 200, end: 200 },
      },
      direction: "forward",
      maxChars: 200,
    });
    expect(secondModelResult.continuation.previous).toEqual({
      locator: firstModelResult.continuation.next.locator,
      direction: "backward",
      maxChars: 200,
    });
  });
});
