import type { ScrapedBook } from "../../public";
import { matchMetadataCandidate } from "./metadata-candidate.matcher";

describe("matchMetadataCandidate", () => {
  const book = {
    title: "策略思维——商界、政界及日常生活中的策略竞争",
    authors: ["阿维纳什·迪克西特", "巴里·奈尔伯夫"],
    isbn: "9787300172621",
  };

  it("classifies an exact normalized ISBN as the same edition", () => {
    expect(matchMetadataCandidate(book, candidate({
      title: "策略思维",
      isbn: "978-7-300-17262-1",
    }))).toEqual({
      level: "edition",
      signals: ["isbn_exact", "title_close", "author_overlap"],
      conflicts: [],
    });
  });

  it("classifies matching title and author as the same work when the edition is unknown", () => {
    expect(matchMetadataCandidate({ ...book, isbn: null }, candidate({
      isbn: null,
    }))).toEqual({
      level: "work",
      signals: ["title_exact", "author_overlap"],
      conflicts: [],
    });
  });

  it("treats an appended translated title as a close title match", () => {
    expect(matchMetadataCandidate(
      { title: "百年孤独", authors: ["[哥伦比亚] 加西亚·马尔克斯"], isbn: "9787544253994" },
      candidate({
        title: "百年孤独 = Cien años de soledad",
        authors: ["加西亚・马尔克斯", "范晔"],
        isbn: "9787544253994",
      }),
    )).toEqual({
      level: "edition",
      signals: ["isbn_exact", "title_close", "author_overlap"],
      conflicts: [],
    });
  });

  it("keeps a title-only match ambiguous", () => {
    expect(matchMetadataCandidate(
      { title: "百年孤独", authors: [], isbn: null },
      candidate({ title: "百年孤独", authors: [], isbn: null }),
    )).toEqual({
      level: "ambiguous",
      signals: ["title_exact"],
      conflicts: [],
    });
  });

  it("reports ISBN and author conflicts instead of hiding them behind a title match", () => {
    expect(matchMetadataCandidate(book, candidate({
      title: book.title,
      authors: ["另一位作者"],
      isbn: "9787020000000",
    }))).toEqual({
      level: "conflict",
      signals: ["title_exact"],
      conflicts: ["isbn_mismatch", "author_mismatch"],
    });
  });

  it("treats AI metadata generated from the selected book as content-derived", () => {
    expect(matchMetadataCandidate(book, candidate({ sourcePlatform: "AI" }))).toEqual({
      level: "edition",
      signals: ["content_derived"],
      conflicts: [],
    });
  });
});

function candidate(overrides: Partial<ScrapedBook> = {}): ScrapedBook {
  return {
    title: "策略思维——商界、政界及日常生活中的策略竞争",
    authors: ["阿维纳什·迪克西特"],
    isbn: "9787300172621",
    publisher: null,
    publishYear: null,
    description: null,
    coverUrl: null,
    language: "zh",
    editionTag: null,
    sourcePlatform: "douban",
    sourceBookId: "subject-1",
    sourceUrl: "https://book.douban.com/subject/subject-1/",
    ...overrides,
  };
}
