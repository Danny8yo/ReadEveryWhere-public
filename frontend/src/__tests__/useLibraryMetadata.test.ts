// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLibrary } from "../features/library/web/useLibrary";
import { fetchLibraryBooks, updateLibraryBook } from "../features/library/api/libraryApi";

vi.mock("../features/library/api/libraryApi", () => ({
  fetchLibraryBooks: vi.fn(),
  addBookManual: vi.fn(),
  importBook: vi.fn(),
  updateLibraryBook: vi.fn(),
  deleteLibraryBook: vi.fn(),
  batchDeleteLibraryBooks: vi.fn(),
  toLibraryDetail: vi.fn((book) => book),
}));

vi.mock('../features/library/web/librarySession',()=>({useLibrarySession:()=>({browse:{query:{page:1,pageSize:20}},status:{connection:'connected',error:null},cache:{subscribe:()=>()=>{},setVisible:()=>{},peek:()=>undefined,invalidate:()=>{},activate:()=>{},read:fetchLibraryBooks,updateBook:()=>{}}})}));
vi.mock("../features/reader/web/bookFileCache", () => ({
  clearBookFileCacheForBook: vi.fn(),
}));

describe("useLibrary metadata update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    });
    vi.mocked(fetchLibraryBooks).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    vi.mocked(updateLibraryBook).mockResolvedValue({} as never);
  });

  it("includes language when saving a confirmed single-book scrape", async () => {
    const library = useLibrary();

    await library.updateBookMetadata(55, {
      title: "活着",
      authors: ["余华"],
      language: "zh",
    });

    expect(updateLibraryBook).toHaveBeenCalledWith(
      55,
      expect.objectContaining({ language: "zh" }),
    );
  });

  it("returns the server-confirmed book so open views can refresh before the list refetch", async () => {
    const saved = { id: 55, title: "活着（新版）", authors: ["余华"], description: "刮削后的简介" };
    vi.mocked(updateLibraryBook).mockResolvedValueOnce(saved as never);
    const library = useLibrary();

    await expect(library.updateBookMetadata(55, { title: "活着（新版）" })).resolves.toEqual(saved);
  });
});
