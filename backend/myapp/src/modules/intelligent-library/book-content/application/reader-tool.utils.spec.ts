import type { BookDocument } from "../domain/book-document.types";
import { makeLocator } from "./reader-tool.utils";

describe("reader-tool TextQuote", () => {
  it("clips a long anchor at the last useful sentence boundary without changing its start", () => {
    const firstSentence = `${"甲".repeat(180)}。`;
    const text = `${firstSentence}${"乙".repeat(100)}。`;
    const document: BookDocument = {
      bookId: 42,
      revision: { fileChecksum: "sha256:x", extractorVersion: "epub-extractor-v2", normalizationVersion: "epub-text-v1" },
      tocQuality: "spine_fallback",
      tocProvenance: {
        source: "spine_fallback",
        positionStrategy: "spine_fallback",
        hierarchyStrategy: "spine_fallback",
        headingMappedNodeCount: 0,
        inferredParentCount: 0,
      },
      sections: [{ sectionIndex: 0, href: "chapter.xhtml", text, charCount: text.length, anchors: {} }],
      toc: [],
    };

    const locator = makeLocator(document, 0, 0, text.length);

    expect(locator.position.end).toBe(text.length);
    expect(locator.textQuote?.exact).toBe(firstSentence);
    expect(locator.textQuote?.suffix).toBe("乙".repeat(64));
  });
});
