import { ListBookAnnotationsUseCase } from "./list-book-annotations.use-case";

describe("ListBookAnnotationsUseCase", () => {
  it("reanchors a same-revision annotation by TextQuote when stored positions are missing", async () => {
    const checksum = "sha256:fixture";
    const useCase = new ListBookAnnotationsUseCase(
      { getOwnedBook: () => ({ id: 11, title: "Fixture", authors: ["Author"] }) } as any,
      { loadDocument: async () => ({
        bookId: 11,
        revision: { fileChecksum: checksum, extractorVersion: "1", normalizationVersion: "1" },
        tocQuality: "declared",
        sections: [{
          sectionIndex: 0,
          href: "chapter.xhtml",
          text: "开头。阅读必须以可核验证据为基础。结尾。",
          charCount: 24,
          anchors: {},
        }],
        toc: [],
      }) } as any,
      { listByBook: () => [{
        id: "annotation-1",
        userId: 1,
        bookId: 11,
        bookHash: checksum,
        annotationType: "highlight",
        color: "#fde047",
        location: "epubcfi(/6/2)",
        locationType: "epubcfi",
        textContent: "阅读必须以可核验证据为基础",
        contextBefore: "开头。",
        contextAfter: "。结尾。",
        chapterLabel: "第一章",
        sectionIndex: 0,
        textPositionStart: null,
        textPositionEnd: null,
        sortKey: null,
        note: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }] } as any,
    );

    const result = await useCase.execute(1, 11, {});

    expect(result.items[0]).toMatchObject({
      location: {
        quality: "exact",
        locator: {
          position: { sectionIndex: 0, start: 3, end: 16 },
          textQuote: { exact: "阅读必须以可核验证据为基础" },
        },
      },
      citation: {
        evidenceType: "user_annotation",
        annotationId: "annotation-1",
      },
    });
  });
});
