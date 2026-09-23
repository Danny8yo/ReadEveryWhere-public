import type { EvidenceRecord } from "../domain";
import { parseToolArguments } from "./agent-tool.schemas";
import { ModelToolResultPresenter } from "./model-tool-result.presenter";
import { toModelVisibleData } from "./model-visible-data";

describe("ModelToolResultPresenter", () => {
  const presenter = new ModelToolResultPresenter();

  it("projects 100 outline entries to the allowed high-signal fields with subtree chars", () => {
    const output = tocOutput(100);
    const projected = presenter.present("book_toc", output) as any;
    const previousModelResult = toModelVisibleData(output);

    expect(Object.keys(projected).sort()).toEqual(["entries", "hasMore", "nextCursor"]);
    expect(projected.entries).toHaveLength(100);
    for (const [index, entry] of projected.entries.entries()) {
      expect(Object.keys(entry).sort()).toEqual([
        "chars",
        "hasChildren",
        "label",
        "level",
        "nodeId",
        "parentNodeId",
      ]);
      expect(entry).toEqual({
        nodeId: `node-${index}`,
        parentNodeId: index === 0 ? null : `node-${index - 1}`,
        label: `Chapter ${index}`,
        level: index % 4,
        chars: 20_000 + index,
        hasChildren: index < 99,
      });
    }
    expect(projected).toMatchObject({ nextCursor: "page-2", hasMore: true });
    expect(JSON.stringify(previousModelResult)).toHaveLength(26_120);
    expect(JSON.stringify(projected)).toHaveLength(11_016);
    expect(JSON.stringify(projected).length).toBeLessThan(JSON.stringify(previousModelResult).length * 0.6);
  });

  it("preserves cross-page hierarchy signals without repeating paths or linear indexes", () => {
    const firstPage = presenter.present("book_toc", {
      ...tocOutput(0),
      entries: [{
        nodeId: "parent",
        parentNodeId: null,
        linearIndex: 99,
        level: 1,
        label: "Part Two",
        path: "Book > Part Two",
        ownCharCount: 10,
        subtreeCharCount: 8_000,
        hasChildren: true,
      }],
      nextCursor: "child-page",
      hasMore: true,
    }) as any;
    const secondPage = presenter.present("book_toc", {
      ...tocOutput(0),
      entries: [{
        nodeId: "child",
        parentNodeId: "parent",
        linearIndex: 100,
        level: 2,
        label: "Chapter Ten",
        path: "Book > Part Two > Chapter Ten",
        ownCharCount: 2_000,
        subtreeCharCount: 2_000,
        hasChildren: false,
      }],
      nextCursor: null,
      hasMore: false,
    }) as any;

    expect(firstPage.entries[0]).toMatchObject({ nodeId: "parent", hasChildren: true });
    expect(secondPage.entries[0]).toMatchObject({ parentNodeId: "parent", level: 2 });
    expect(JSON.stringify([firstPage, secondPage])).not.toMatch(/path|linearIndex|ownCharCount|subtreeCharCount/);
  });

  it("keeps tree hierarchy and projects navigation locators to the minimum readable shape", () => {
    const tree = presenter.present("book_toc_tree", {
      entries: [{
        nodeId: "root",
        linearIndex: 0,
        label: "Root",
        ownCharCount: 20,
        subtreeCharCount: 200,
        children: [{
          nodeId: "leaf",
          linearIndex: 1,
          label: "Leaf",
          ownCharCount: 180,
          subtreeCharCount: 180,
          children: [],
        }],
      }],
    }) as any;
    const navigation = presenter.present("book_toc_navigation", {
      entries: [{
        nodeId: "leaf",
        parentNodeId: "root",
        linearIndex: 1,
        level: 1,
        label: "Leaf",
        path: "Root > Leaf",
        ownCharCount: 180,
        subtreeCharCount: 180,
        hasChildren: false,
        startLocator: fullLocator(3, 120, 120),
        endLocator: fullLocator(4, 240, 240),
      }],
      nextCursor: null,
      hasMore: false,
    }) as any;

    expect(tree).toEqual({
      entries: [{
        nodeId: "root",
        label: "Root",
        chars: 200,
        children: [{ nodeId: "leaf", label: "Leaf", chars: 180, children: [] }],
      }],
    });
    expect(navigation).toEqual({
      entries: [{
        nodeId: "leaf",
        label: "Leaf",
        startLocator: minimumLocator(3, 120, 120),
        endLocator: minimumLocator(4, 240, 240),
      }],
    });
    expect(parseToolArguments("book_read", { locator: navigation.entries[0].startLocator }))
      .toEqual({ locator: minimumLocator(3, 120, 120) });
    expect(parseToolArguments("book_read", {
      locator: navigation.entries[0].endLocator,
      direction: "backward",
    })).toEqual({
      locator: minimumLocator(4, 240, 240),
      direction: "backward",
    });
  });

  it("sends an 8,000-character read body once while retaining only evidence ranges", () => {
    const text = Array.from({ length: 8_000 }, (_, index) => String.fromCharCode(0x4e00 + (index % 200))).join("");
    const output = readOutput(text);
    const evidence = evidenceFor(text);
    const evidenceSnapshot = JSON.parse(JSON.stringify(evidence));
    const previousModelResult = {
      ...(toModelVisibleData(output) as Record<string, unknown>),
      evidence: evidence.map((record) => ({
        evidenceId: record.evidenceId,
        quote: record.quote,
        citation: toModelVisibleData(record.citation),
      })),
    };

    const projected = presenter.present("book_read", output, evidence) as any;
    const serialized = JSON.stringify(projected);

    expect(projected).toEqual({
      text,
      segments: [{
        textStart: 0,
        textEnd: 8_000,
        sectionIndex: 2,
        start: 0,
        end: 8_000,
        chapterPath: "Part One > Chapter One",
      }],
      continuation: {
        previous: { locator: minimumLocator(2, 0, 0), direction: "backward" },
        next: { locator: minimumLocator(2, 8_000, 8_000), direction: "forward" },
      },
      boundary: {
        sectionStart: true,
        sectionEnd: false,
        bookStart: false,
        bookEnd: false,
      },
      evidence: [
        { evidenceId: "evidence-0", textStart: 0, textEnd: 1_500 },
        { evidenceId: "evidence-1", textStart: 1_500, textEnd: 3_000 },
        { evidenceId: "evidence-2", textStart: 3_000, textEnd: 4_500 },
        { evidenceId: "evidence-3", textStart: 4_500, textEnd: 6_000 },
        { evidenceId: "evidence-4", textStart: 6_000, textEnd: 7_500 },
        { evidenceId: "evidence-5", textStart: 7_500, textEnd: 8_000 },
      ],
    });
    expect(serialized.split(text)).toHaveLength(2);
    expect(serialized).not.toMatch(/quote|citation|textQuote|structure|bookId|contentRevision|userId/);
    expect(JSON.stringify(previousModelResult).length).toBeGreaterThan(27_000);
    expect(JSON.stringify(projected).length).toBeLessThan(JSON.stringify(previousModelResult).length * 0.5);
    expect(evidence).toEqual(evidenceSnapshot);
    expect(evidence[0]).toMatchObject({
      quote: text.slice(0, 1_500),
      sourceTextHash: "a".repeat(64),
      citation: {
        bookId: "42",
        contentRevision: "trusted-revision",
        locator: expect.objectContaining({
          contentRevision: expect.any(Object),
          textQuote: expect.any(Object),
          structure: expect.any(Object),
        }),
      },
    });
    expect(parseToolArguments("book_read", projected.continuation.previous)).toBeDefined();
    expect(parseToolArguments("book_read", projected.continuation.next)).toBeDefined();
  });

  it("projects one cross-section read with globally adjusted evidence offsets", () => {
    const firstText = `${"a".repeat(3_995)}CROSS_SECTION_ARGUMENT`;
    const secondText = "b".repeat(4_000);
    const output = {
      text: firstText + secondText,
      segments: [
        { textStart: 0, textEnd: firstText.length, citation: { chapterPath: "One", locator: fullLocator(2, 0, firstText.length) } },
        { textStart: firstText.length, textEnd: firstText.length + secondText.length,
          citation: { chapterPath: "Two", locator: fullLocator(3, 0, secondText.length) } },
      ],
      previousLocator: fullLocator(1, 500, 500),
      nextLocator: fullLocator(4, 0, 0),
      continuation: { previous: null, next: null },
      boundary: { sectionStart: true, sectionEnd: true, bookStart: false, bookEnd: false },
    };
    const firstEvidence = evidenceForPage(firstText, 0, "section-front", 2);
    const secondEvidence = evidenceForPage(secondText, 0, "section-back", 3);

    const projected = presenter.present("book_read", output, [...firstEvidence, ...secondEvidence]) as any;

    expect(projected.text).toBe(firstText + secondText);
    expect(projected.text).toContain("CROSS_SECTION_ARGUMENT");
    expect(projected.continuation).toEqual({ previous: null, next: null });
    expect(projected.segments).toEqual([
      expect.objectContaining({ textStart: 0, textEnd: firstText.length, sectionIndex: 2, start: 0, end: firstText.length }),
      expect.objectContaining({
        textStart: firstText.length,
        textEnd: firstText.length + secondText.length,
        sectionIndex: 3,
        start: 0,
        end: secondText.length,
      }),
    ]);
    expect(projected.evidence).toEqual([
      { evidenceId: "section-front", textStart: 0, textEnd: firstText.length },
      {
        evidenceId: "section-back",
        textStart: firstText.length,
        textEnd: firstText.length + secondText.length,
      },
    ]);
    expect(JSON.stringify(projected)).not.toMatch(/quote|citation|textQuote|structure|bookId|contentRevision|userId/);
  });

  it("preserves maxChars in directly reusable reading continuations", () => {
    const output = {
      ...readOutput("a".repeat(8_000)),
      continuation: {
        previous: null,
        next: {
          locator: fullLocator(2, 8_000, 8_000),
          endLocator: fullLocator(4, 2_000, 2_000),
          direction: "forward",
          maxChars: 50_000,
        },
      },
    };

    const projected = presenter.present("book_read", output) as any;

    expect(projected.continuation.next).toEqual({
      locator: minimumLocator(2, 8_000, 8_000),
      endLocator: minimumLocator(4, 2_000, 2_000),
      direction: "forward",
      maxChars: 50_000,
    });
    expect(parseToolArguments("book_read", projected.continuation.next)).toBeDefined();
  });

  it("projects a 50000-character Tool result once with contiguous evidence ranges", () => {
    const text = "章".repeat(50_000);
    const projected = presenter.present("book_read", readOutput(text), evidenceFor(text)) as any;
    const serialized = JSON.stringify(projected);

    expect(projected.text).toBe(text);
    expect(serialized.split(text)).toHaveLength(2);
    expect(projected.segments).toEqual([expect.objectContaining({
      textStart: 0,
      textEnd: 50_000,
      sectionIndex: 2,
      start: 0,
      end: 50_000,
    })]);
    expect(projected.evidence).toHaveLength(Math.ceil(50_000 / 1_500));
    expect(projected.evidence[0]).toEqual({ evidenceId: "evidence-0", textStart: 0, textEnd: 1_500 });
    expect(projected.evidence.at(-1)).toEqual({
      evidenceId: `evidence-${Math.ceil(50_000 / 1_500) - 1}`,
      textStart: 49_500,
      textEnd: 50_000,
    });
  });

  it("keeps trusted scope fields out of unchanged tool projections", () => {
    const projected = presenter.present("book_search_text", {
      userId: 7,
      bookId: 42,
      contentRevision: { fileChecksum: "secret-revision" },
      hits: [{
        citation: {
          bookId: 42,
          locator: fullLocator(1, 10, 20),
        },
      }],
    });

    expect(JSON.stringify(projected)).not.toMatch(/userId|bookId|contentRevision|secret-revision/);
  });
});

function tocOutput(count: number) {
  return {
    bookId: 42,
    contentRevision: {
      fileChecksum: `sha256:${"f".repeat(64)}`,
      extractorVersion: "epub-extractor-v1",
      normalizationVersion: "epub-text-v1",
    },
    tocQuality: "declared",
    entries: Array.from({ length: count }, (_, index) => ({
      nodeId: `node-${index}`,
      parentNodeId: index === 0 ? null : `node-${index - 1}`,
      linearIndex: index,
      level: index % 4,
      label: `Chapter ${index}`,
      path: `Book > Part ${Math.floor(index / 10)} > Chapter ${index} > ${"context ".repeat(8)}`,
      ownCharCount: 1_000 + index,
      subtreeCharCount: 20_000 + index,
      hasChildren: index < count - 1,
    })),
    nextCursor: "page-2",
    hasMore: true,
  };
}

function readOutput(text: string) {
  return {
    text,
    previousLocator: fullLocator(2, 0, 0),
    nextLocator: fullLocator(2, 8_000, 8_000),
    reachedSectionStart: true,
    reachedSectionEnd: false,
    reachedBookStart: false,
    reachedBookEnd: false,
    segments: [{
      textStart: 0,
      textEnd: text.length,
      citation: {
        sourceKind: "book_text",
        evidenceType: "read_context",
        bookId: 42,
        bookTitle: "Fixture",
        authors: ["Author"],
        chapterPath: "Part One > Chapter One",
        locator: fullLocator(2, 0, text.length),
        annotationId: null,
      },
    }],
  };
}

function evidenceForPage(text: string, start: number, evidenceId: string, sectionIndex = 2): EvidenceRecord[] {
  return [{
    evidenceId,
    taskId: "task-1",
    agentRunId: "run-1",
    scope: { userId: "7", bookId: "42", contentRevision: "trusted-revision" },
    quote: text,
    citation: {
      bookId: "42",
      contentRevision: "trusted-revision",
      chapterPath: "Part One > Chapter One",
      locator: fullLocator(sectionIndex, start, start + text.length),
    },
    sourceTool: "book_read",
    sourceTextHash: "a".repeat(64),
    createdAt: "2026-08-08T00:00:00.000Z",
  }];
}

function evidenceFor(text: string): EvidenceRecord[] {
  const records: EvidenceRecord[] = [];
  for (let offset = 0; offset < text.length; offset += 1_500) {
    const quote = text.slice(offset, offset + 1_500);
    records.push({
      evidenceId: `evidence-${records.length}`,
      taskId: "task-1",
      agentRunId: "run-1",
      scope: { userId: "7", bookId: "42", contentRevision: "trusted-revision" },
      quote,
      citation: {
        bookId: "42",
        contentRevision: "trusted-revision",
        chapterPath: "Part One > Chapter One",
        quote,
        locator: fullLocator(2, offset, offset + quote.length),
      },
      sourceTool: "book_read",
      sourceTextHash: "a".repeat(64),
      createdAt: "2026-08-08T00:00:00.000Z",
    });
  }
  return records;
}

function minimumLocator(sectionIndex: number, start: number, end: number) {
  return {
    version: 1,
    position: { kind: "epub_text", sectionIndex, start, end },
  };
}

function fullLocator(sectionIndex: number, start: number, end: number) {
  return {
    ...minimumLocator(sectionIndex, start, end),
    bookId: 42,
    contentRevision: {
      fileChecksum: `sha256:${"f".repeat(64)}`,
      extractorVersion: "epub-extractor-v1",
      normalizationVersion: "epub-text-v1",
    },
    textQuote: { exact: "quoted text", prefix: "before", suffix: "after" },
    structure: {
      tocNodeId: "node-1",
      href: "chapter.xhtml",
      label: "Chapter One",
      path: "Part One > Chapter One",
    },
    readerAnchor: { epubcfi: "epubcfi(/6/2!/4/2:0)" },
  };
}
