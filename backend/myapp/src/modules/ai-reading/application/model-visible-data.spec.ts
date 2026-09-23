import { toModelVisibleData } from "./model-visible-data";

describe("model-visible data", () => {
  it("recursively removes trusted scope while preserving usable locators", () => {
    expect(toModelVisibleData({
      userId: 7,
      contentRevision: { fileChecksum: "secret-scope" },
      hits: [{
        locator: {
          version: 1,
          bookId: 42,
          contentRevision: { fileChecksum: "secret-scope" },
          position: { kind: "epub_text", sectionIndex: 3, start: 4, end: 5 },
        },
      }],
    })).toEqual({
      hits: [{
        locator: {
          version: 1,
          position: { kind: "epub_text", sectionIndex: 3, start: 4, end: 5 },
        },
      }],
    });
  });
});
