import { GenerateBookMetadataUseCase } from "./generate-book-metadata.use-case";

describe("GenerateBookMetadataUseCase", () => {
  it("selects bounded sections, then returns an AI candidate merged with current metadata", async () => {
    const content = {
      inspect: jest.fn().mockResolvedValue({
        book: { id: 7, title: "Old title", authors: ["Author"], isbn: null, language: null, coverUrl: "cover.jpg", description: null, publisher: null, publishYear: null, editionTag: null },
        format: "epub",
        contentRevision: { fileChecksum: "sha256:x", extractorVersion: "x", normalizationVersion: "x" },
        sections: [{ sectionId: "preface", label: "Preface", path: "Preface", order: 0, charCount: 20 }],
      }),
      readSections: jest.fn().mockResolvedValue([{ sectionId: "preface", label: "Preface", path: "Preface", order: 0, text: "A preface" }]),
    };
    const model = {
      selectFrontMatter: jest.fn().mockResolvedValue({ sectionIds: ["preface"] }),
      generateMetadata: jest.fn().mockResolvedValue({ title: "New title", authors: [], isbn: null, publisher: "Publisher", publishYear: null, description: "Summary", language: "en", editionTag: null }),
    };

    const result = await new GenerateBookMetadataUseCase(content, model).execute(3, 7, "req-1");

    expect(model.selectFrontMatter).toHaveBeenCalledWith(expect.objectContaining({ userId: 3 }));
    expect(content.readSections).toHaveBeenCalledWith(3, 7, ["preface"], expect.any(Object));
    expect(result).toMatchObject({ sourcePlatform: "AI", sourceBookId: "book:7", sourceUrl: null, title: "New title", authors: ["Author"], coverUrl: "cover.jpg", language: "en" });
  });

  it("rejects model-selected section ids outside the inspected book", async () => {
    const content = {
      inspect: jest.fn().mockResolvedValue({ book: { id: 7, title: "Book", authors: [], isbn: null, language: null, coverUrl: null, description: null, publisher: null, publishYear: null, editionTag: null }, format: "epub", contentRevision: {}, sections: [] }),
      readSections: jest.fn(),
    };
    const model = { selectFrontMatter: jest.fn().mockResolvedValue({ sectionIds: ["chapter-1"] }), generateMetadata: jest.fn() };
    await expect(new GenerateBookMetadataUseCase(content, model).execute(3, 7, "req-1")).rejects.toThrow("unknown metadata section");
    expect(content.readSections).not.toHaveBeenCalled();
  });
});
