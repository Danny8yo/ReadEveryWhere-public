import type { BookDocument } from "../domain/book-document.types";
import { planTocRead } from "./toc-read-batch";
import { BookDocumentLoader } from "./book-document.loader";
import { ReadBookUseCase } from "./use-cases/read-book.use-case";
import { ReadBookFromTocUseCase } from "./use-cases/read-book-from-toc.use-case";
import type { BookContentSourcePort } from "./ports/book-content-source.port";
import { decodeCursor, encodeCursor } from "./reader-tool.utils";

type Node = { id: string; start: number; end: number; parent?: string };
function fixture(sizes: number[], nodes?: Node[]): BookDocument {
  const length = sizes.reduce((sum, size) => sum + size, 0);
  const definitions: Node[] = nodes ?? sizes.map((size, index) => ({ id: `n${index}`, start: sizes.slice(0, index).reduce((a, b) => a + b, 0), end: sizes.slice(0, index + 1).reduce((a, b) => a + b, 0) }));
  const level = (node: Node): number => node.parent ? 1 + level(definitions.find((item) => item.id === node.parent)!) : 1;
  return {
    bookId: 42, revision: { fileChecksum: "fixture", extractorVersion: "v4", normalizationVersion: "v1" },
    tocQuality: "declared", tocProvenance: { source: "epub_nav", positionStrategy: "declared", hierarchyStrategy: "declared", headingMappedNodeCount: 0, inferredParentCount: 0 },
    sections: [{ sectionIndex: 0, href: "one.xhtml", text: sizes.map((size, index) => String.fromCharCode(65 + index % 26).repeat(size)).join(""), charCount: length, anchors: {} }],
    toc: definitions.map((node, index) => {
      const children = definitions.filter((item) => item.parent === node.id);
      return { nodeId: node.id, parentNodeId: node.parent ?? null, linearIndex: index, level: level(node), label: node.id, path: node.id,
        href: "one.xhtml", fragment: null, sectionIndex: 0, start: node.start, endSectionIndex: 0, end: node.end,
        subtreeCharCount: node.end - node.start, ownCharCount: node.end - node.start - children.reduce((sum, child) => sum + child.end - child.start, 0),
        hasChildren: children.length > 0, sourceHeadingLevel: null };
    }),
  };
}
function reader(document: BookDocument) {
  const loader = { load: async () => document } as unknown as BookDocumentLoader;
  const source = { findOwnedBook: () => ({ id: 42, title: "Fixture", authors: [] }) } as unknown as BookContentSourcePort;
  return new ReadBookFromTocUseCase(loader, new ReadBookUseCase(source, loader));
}

describe("structural TOC batches", () => {
  it("sorts and deduplicates selections without reading intervening nodes", async () => {
    const doc = fixture([10, 20, 30]);
    const result = await reader(doc).execute(1, 42, { nodeIds: ["n2", "n0", "n2"] });
    expect(result.text).toBe("A".repeat(10) + "C".repeat(30));
    expect(result.units.map((unit) => [unit.nodeId, unit.textStart, unit.textEnd])).toEqual([["n0", 0, 10], ["n2", 10, 40]]);
    expect(result.segments.map((segment) => [segment.citation.locator.position.start, segment.citation.locator.position.end])).toEqual([[0, 10], [30, 60]]);
    expect(result.coverage.complete).toBe(true);
    expect(result).not.toHaveProperty("boundary");
  });

  it("splits large parents recursively, preserves own text, and eliminates selected descendants", async () => {
    const doc = fixture([2_000, 20_000, 24_000, 18_000], [
      { id: "root", start: 0, end: 64_000 },
      { id: "branch", parent: "root", start: 2_000, end: 64_000 },
      { id: "a", parent: "branch", start: 2_000, end: 22_000 },
      { id: "b", parent: "branch", start: 22_000, end: 46_000 },
      { id: "c", parent: "branch", start: 46_000, end: 64_000 },
    ]);
    const useCase = reader(doc);
    const first = await useCase.execute(1, 42, { nodeIds: ["c", "branch", "root", "a"] });
    expect(first.text.length).toBe(46_000);
    expect(first.units.map((unit) => [unit.nodeId, unit.kind])).toEqual([["root", "own"], ["a", "subtree"], ["b", "subtree"]]);
    expect(first.coverage).toMatchObject({ selectedNodeIds: ["root"], complete: false, returnedChars: 46_000, pendingChars: 18_000 });
    const next = first.continuation.next!;
    const second = await useCase.execute(1, 42, next);
    expect(first.text + second.text).toBe(doc.sections[0].text);
    expect(second.coverage.complete).toBe(true);
    expect(await useCase.execute(1, 42, next)).toEqual(second);
  });

  it("does not skip a readable unit just to fill the current batch", () => {
    const doc = fixture([30_000, 30_000, 10]);
    const first = planTocRead(doc, { nodeIds: ["n0", "n1", "n2"] });
    expect(first.units.map((unit) => unit.nodeId)).toEqual(["n0"]);
    expect(planTocRead(doc, first.continuation.next!).units.map((unit) => unit.nodeId)).toEqual(["n1", "n2"]);
  });

  it.each(["leaf", "own"])("reports oversized %s gaps while returning other complete units", async (kind) => {
    const doc = kind === "leaf" ? fixture([10, 50_001, 20]) : fixture([50_001, 20], [
      { id: "n0", start: 0, end: 50_021 }, { id: "n1", parent: "n0", start: 50_001, end: 50_021 },
    ]);
    const result = await reader(doc).execute(1, 42, { nodeIds: doc.toc.map((node) => node.nodeId) });
    expect(result.unavailable).toEqual([expect.objectContaining({ reason: "TOC_NODE_TOO_LARGE", kind: kind === "leaf" ? "subtree" : "own", normalizedCharCount: 50_001 })]);
    expect(result.text.length).toBe(kind === "leaf" ? 30 : 20);
    expect(result.continuation.next).toBeNull();
    expect(result.coverage).toMatchObject({ complete: false, unavailableChars: 50_001, unavailableUnits: 1, pendingChars: 0 });
  });

  it("bounds unavailable metadata and preserves partial coverage on the final page", () => {
    const count = 201;
    const doc = fixture(Array(count).fill(50_001), [
      { id: "root", start: 0, end: count * 50_001 },
      ...Array.from({ length: count }, (_, index) => ({ id: `n${index}`, parent: "root", start: index * 50_001, end: (index + 1) * 50_001 })),
    ]);
    const first = planTocRead(doc, { nodeIds: ["root"] });
    expect(first.unavailable).toHaveLength(200);
    expect(first.normalizedCharCount).toBe(0);
    const last = planTocRead(doc, first.continuation.next!);
    expect(last.unavailable).toHaveLength(1);
    expect(last.continuation.next).toBeNull();
    expect(last.coverage).toMatchObject({ complete: false, unavailableUnits: 201 });
  });

  it("rejects stale, cross-book, out-of-range and noncanonical cursors", () => {
    const doc = fixture([30_000, 30_000, 10]);
    const next = planTocRead(doc, { nodeIds: ["n0", "n1", "n2"] }).continuation.next!;
    const payload = decodeCursor<Record<string, unknown>>(next.cursor, () => true)!;
    for (const patch of [{ revision: "stale" }, { bookId: 9 }, { offset: 2 }, { offset: 3 }, { offset: 0 }]) {
      expect(() => planTocRead(doc, { cursor: encodeCursor({ ...payload, ...patch }) })).toThrow(expect.objectContaining({ details: expect.objectContaining({ reason: "CURSOR_INVALID" }) }));
    }
  });

  it("rejects unsupported input and inconsistent structure", () => {
    const doc = fixture([10, 20]);
    for (const input of [{}, { nodeId: "n0" }, { nodeIds: [] }, { nodeIds: ["n0"], cursor: "x" }, { nodeIds: ["n0"], maxChars: 500 }]) {
      expect(() => planTocRead(doc, input as any)).toThrow(expect.objectContaining({ details: expect.objectContaining({ reason: "TOC_REQUEST_INVALID" }) }));
    }
    doc.toc[0].ownCharCount++;
    expect(() => planTocRead(doc, { nodeIds: ["n0"] })).toThrow(/own count mismatch/);
    const overlapping = fixture([60_000], [{ id: "root", start: 0, end: 60_000 },
      { id: "a", parent: "root", start: 0, end: 35_000 }, { id: "b", parent: "root", start: 30_000, end: 60_000 }]);
    expect(() => planTocRead(overlapping, { nodeIds: ["root"] })).toThrow(/overlapping/);
  });
});
