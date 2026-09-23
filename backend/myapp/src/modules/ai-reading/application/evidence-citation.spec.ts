import { citationForEvidenceChunk } from "./evidence-citation";

describe("citationForEvidenceChunk", () => {
  it("keeps the evidence range while bounding the replayable TextQuote", () => {
    const prefix = "p".repeat(80);
    const quote = "q".repeat(1_500);
    const suffix = "s".repeat(80);

    const citation = citationForEvidenceChunk({
      locator: {
        version: 1,
        position: { kind: "epub_text", sectionIndex: 2, start: 100, end: 100 },
      },
    }, `${prefix}${quote}${suffix}`, prefix.length, quote) as any;

    expect(citation.locator.position).toMatchObject({ start: 180, end: 1_680 });
    expect(citation.locator.textQuote.exact).toBe(quote.slice(0, 256));
    expect(citation.locator.textQuote.prefix).toBe(prefix.slice(-64));
    expect(citation.locator.textQuote.suffix).toBe(suffix.slice(0, 64));
    expect(citation.quote).toBe(quote);
  });
});
