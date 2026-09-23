// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ScraperModal from "../components/library/ScraperModal.vue";
import type { LibraryBook } from '../features/library/model/library';
import { buildMetadataScrapeKeyword } from "../features/metadata/domain/keyword";

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
    const wrapper = mount(ScraperModal, {
      props: { isOpen: true, book: book as LibraryBook },
    });

    expect((wrapper.get("input").element as HTMLInputElement).value).toBe("活着");
  });
});
