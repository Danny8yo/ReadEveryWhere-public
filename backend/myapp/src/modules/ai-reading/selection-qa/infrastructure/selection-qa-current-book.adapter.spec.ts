import type { LibraryQueryPort } from "../../../intelligent-library/public/library-query.port";
import { SelectionQaCurrentBookAdapter } from "./selection-qa-current-book.adapter";

const book = (id: number, title: string) => ({ id, title }) as ReturnType<LibraryQueryPort["getOwnedBook"]>;

describe("selection QA authoritative current book", () => {
  it("uses the owned catalog title, including an edit on the next turn", () => {
    let title = "大型网站技术架构";
    const lookup = jest.fn(({ userId, bookId }) => userId === 1 && bookId === 9 ? book(9, title) : null);
    const adapter = new SelectionQaCurrentBookAdapter({ getOwnedBook: lookup } as unknown as LibraryQueryPort);
    expect(adapter.get(1, 9)).toEqual({ bookId: 9, title });
    title = "大型网站技术架构（修订版）";
    expect(adapter.get(1, 9).title).toBe(title);
    expect(() => adapter.get(2, 9)).toThrow(expect.objectContaining({ code: "CURRENT_BOOK_UNAVAILABLE" }));
    expect(lookup).toHaveBeenCalledWith({ userId: 2, bookId: 9 });
  });

  it.each([null, book(8, "另一册书"), book(9, "   ")])("rejects missing, mismatched or blank catalog identity", value => {
    const adapter = new SelectionQaCurrentBookAdapter({ getOwnedBook: () => value } as unknown as LibraryQueryPort);
    expect(() => adapter.get(1, 9)).toThrow(expect.objectContaining({ code: "CURRENT_BOOK_UNAVAILABLE" }));
  });
});
