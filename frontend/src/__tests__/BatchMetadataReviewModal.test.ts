// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BatchMetadataReviewModal from "../components/library/BatchMetadataReviewModal.vue";
import type { LibraryBook } from '../features/library/model/library';
import { applyMetadataToBook, scrapeMetadata } from "../features/metadata/api/metadataApi";
import type { MatchedMetadataCandidate } from '../features/metadata/model/metadata';

vi.mock("../features/metadata/api/metadataApi", async () => {
  const actual = await vi.importActual<typeof import("../features/metadata/api/metadataApi")>("../features/metadata/api/metadataApi");
  return {
    ...actual,
    scrapeMetadata: vi.fn(),
    applyMetadataToBook: vi.fn(),
  };
});

vi.mock('../features/library/api/libraryApi',()=>({getLibraryBook:vi.fn(async(id:number)=>books.find(book=>book.id===id))}));

describe("BatchMetadataReviewModal", () => {
  beforeEach(() => {
    vi.mocked(scrapeMetadata).mockReset();
    vi.mocked(applyMetadataToBook).mockReset();
    vi.mocked(applyMetadataToBook).mockImplementation(async (bookId) => books.find((book) => book.id === bookId)!);
  });

  it("collects provider-neutral candidates before writing and only pre-accepts edition matches", async () => {
    vi.mocked(scrapeMetadata)
      .mockResolvedValueOnce([matched("edition", "candidate-1")])
      .mockResolvedValueOnce([matched("work", "candidate-2")]);

    const wrapper = mount(BatchMetadataReviewModal, {
      props: { isOpen: true, books, provider: "zlibrary" },
    });
    await flushPromises();

    expect(scrapeMetadata).toHaveBeenNthCalledWith(1, {
      provider: "zlibrary",
      bookId: 1,
      keyword: "百年孤独",
    });
    expect(scrapeMetadata).toHaveBeenNthCalledWith(2, {
      provider: "zlibrary",
      bookId: 2,
      keyword: "策略思维",
    });
    expect(applyMetadataToBook).not.toHaveBeenCalled();
    expect(wrapper.get('[data-testid="batch-metadata-summary"]').text()).toContain("可应用 1");
    expect(wrapper.get('[data-testid="batch-metadata-summary"]').text()).toContain("待确认 1");

    await wrapper.get('[data-testid="confirm-candidate"]').trigger("click");
    await wrapper.get('[data-testid="apply-confirmed"]').trigger("click");
    await flushPromises();

    expect(applyMetadataToBook).toHaveBeenCalledTimes(2);
    expect(applyMetadataToBook).toHaveBeenNthCalledWith(1, 1, 1, expect.objectContaining({ sourceBookId: "candidate-1" }));
    expect(applyMetadataToBook).toHaveBeenNthCalledWith(2, 2, 1, expect.objectContaining({ sourceBookId: "candidate-2" }));
  });

  it("keeps a failed book reviewable and supports retrying with an edited keyword", async () => {
    vi.mocked(scrapeMetadata)
      .mockRejectedValueOnce(new Error("upstream timeout"))
      .mockResolvedValueOnce([matched("work", "retried")]);

    const wrapper = mount(BatchMetadataReviewModal, {
      props: { isOpen: true, books: [books[0]], provider: "douban" },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("upstream timeout");
    await wrapper.get('[data-testid="retry-keyword"]').setValue("百年孤独 马尔克斯");
    await wrapper.get('[data-testid="retry-candidate-search"]').trigger("click");
    await flushPromises();

    expect(scrapeMetadata).toHaveBeenLastCalledWith({
      provider: "douban",
      bookId: 1,
      keyword: "百年孤独 马尔克斯",
    });
    expect(wrapper.get('[data-testid="batch-metadata-summary"]').text()).toContain("待确认 1");
  });
});

const books = [
  book({ id: 1, title: "百年孤独", authors: ["加西亚·马尔克斯"] }),
  book({ id: 2, title: "策略思维", authors: ["阿维纳什·迪克西特"] }),
];

function book(overrides: Partial<LibraryBook>): LibraryBook {
  return {
    id: 1,
    userId: 1,
    title: "书名",
    authors: [],
    authorsText: "",
    isbn: null,
    language: "zh",
    coverUrl: null,
    description: null,
    publisher: null,
    sourcePlatform: "manual",
    sourceBookId: null,
    sourceUrl: null,
    publishYear: null,
    editionTag: null,
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    fileSize: null,
    isDownloaded: true,
    format: "epub",
    doubanRating: null,
    ...overrides,
  };
}

function matched(level: MatchedMetadataCandidate["match"]["level"], sourceBookId: string): MatchedMetadataCandidate {
  return {
    candidate: {
      title: sourceBookId,
      authors: ["作者"],
      isbn: null,
      publisher: "出版社",
      publishYear: 2020,
      description: "简介",
      coverUrl: null,
      language: "zh",
      editionTag: null,
      sourcePlatform: "test",
      sourceBookId,
      sourceUrl: null,
    },
    match: {
      level,
      signals: level === "edition" ? ["isbn_exact"] : ["title_exact", "author_overlap"],
      conflicts: [],
    },
  };
}

vi.mock('../features/library/web/librarySession', () => ({ useLibraryInvalidation: () => ({invalidate: vi.fn()}), withLibraryInvalidation: (_port: unknown, command: unknown) => command }));
