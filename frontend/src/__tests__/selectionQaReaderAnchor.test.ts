// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { FoliateReaderAdapter } from "../lib/reader/adapters/FoliateReaderAdapter";
import type { ReaderSelectionEvent } from "../features/reader/domain/ReaderPort";
describe("EPUB selection anchor", () => {
  it("exports physical manifest href and exact whitespace independently from trimmed legacy text", () => {
    document.body.innerHTML = "<p>  同一原文  </p>";
    const text = document.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 8);
    Object.defineProperty(range, "getBoundingClientRect", {
      value: () => ({
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        left: 0,
        top: 0,
        right: 10,
        bottom: 10,
      }),
    });
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const adapter = new FoliateReaderAdapter();
    const cfi = "epubcfi(/6/2!/4/2,/1:0,/1:8)";
    (adapter as unknown as { view: unknown }).view = {
      book: { sections: [{ id: "OPS/physical.xhtml" }] },
      getCFI: vi.fn(() => cfi),
      renderer: { getContents: () => [] },
    };
    let event: ReaderSelectionEvent | undefined;
    adapter.on("selection", (value) => {
      event = value;
    });
    (
      adapter as unknown as {
        handleSelection: (index: number, doc: Document) => void;
      }
    ).handleSelection(0, document);
    expect(event?.text).toBe("同一原文");
    expect(event?.epubSelection).toEqual({
      sectionIndex: 0,
      href: "OPS/physical.xhtml",
      cfi,
      displayedQuote: "  同一原文  ",
    });
    expect(event?.locator.textQuote?.exact).toBe("  同一原文  ");
    selection.removeAllRanges();
  });
});
