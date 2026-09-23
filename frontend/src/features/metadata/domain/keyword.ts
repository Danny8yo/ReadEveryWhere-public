import type { LibraryBook } from '../../library/model/library';
export function buildMetadataScrapeKeyword(book: Pick<LibraryBook, "title" | "isbn" | "fileName">): string {
    const title = book.title?.trim();
    if (title)
        return title;
    const isbn = book.isbn?.trim();
    if (isbn)
        return isbn;
    return book.fileName?.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ").trim() || "";
}
