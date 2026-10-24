// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import ScraperModal from "../features/metadata/ui/ScraperModal.vue";
import type { LibraryBook } from '../features/library/model/library';
import { buildMetadataScrapeKeyword } from "../features/metadata/domain/keyword";
import { mountInBody } from './helpers/bodyView';

describe("metadata scrape keyword", () => {
  const book: Pick<LibraryBook, "id" | "title" | "isbn" | "authors" | "fileName"> = {
    id: 55,
    title: "活着",
    isbn: "9787506365437",
    authors: ["余华"],
    fileName: "living.epub",
  };

  it("prefers the title over ISBN and file name", () => {
    expect(buildMetadataScrapeKeyword(book)).toBe("活着");
  });

  it("falls back to ISBN and then the normalized file name", () => {
    expect(buildMetadataScrapeKeyword({ ...book, title: "" })).toBe("9787506365437");
    expect(buildMetadataScrapeKeyword({ ...book, title: "", isbn: null })).toBe("living");
  });

  it("fills the single-book scrape input with the title", () => {
    // 封面流 P6：刮削弹窗经 UiOverlay 渲染到 body，从 body 查询
    const wrapper = mountInBody(ScraperModal, {
      props: { isOpen: true, book: book as LibraryBook },
    });

    expect((wrapper.get("input").element as HTMLInputElement).value).toBe("活着");
    wrapper.unmount();
  });
});
