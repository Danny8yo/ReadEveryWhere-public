import { GetBookMetadataUseCase } from "./get-book-metadata.use-case";

describe("GetBookMetadataUseCase", () => {
  it("exposes TOC mapping quality before an agent chooses navigation", async () => {
    const useCase = new GetBookMetadataUseCase(
      { getOwnedBook: jest.fn(() => ({ id: 42, title: "Fixture", authors: [] })) } as any,
      { loadDocument: jest.fn().mockResolvedValue({
        revision: { fileChecksum: "sha256:x", extractorVersion: "epub-extractor-v2", normalizationVersion: "epub-text-v1" },
        tocQuality: "declared_repaired",
        sections: [{ text: "body" }],
        toc: [{ nodeId: "chapter" }],
      }) } as any,
      { listByBook: jest.fn(() => []) } as any,
    );

    await expect(useCase.execute(1, 42)).resolves.toMatchObject({
      contentStats: {
        tocNodeCount: 1,
        tocQuality: "declared_repaired",
      },
    });
  });
});
