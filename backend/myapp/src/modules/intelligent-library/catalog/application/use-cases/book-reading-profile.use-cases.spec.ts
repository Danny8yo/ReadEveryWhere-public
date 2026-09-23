import { Book } from "../../domain/book";
import type { BookRepositoryPort } from "../ports/book-repository.port";
import { ClearBookReadingProfileUseCase } from "./clear-book-reading-profile.use-case";
import { EditBookReadingProfileUseCase } from "./edit-book-reading-profile.use-case";
import { GetBookReadingProfileUseCase } from "./get-book-reading-profile.use-case";

describe("Book reading profile use cases", () => {
  it("reads the profile only through the owned Book aggregate", () => {
    const books = fakeBooks(book());
    const result = new GetBookReadingProfileUseCase(books).execute(7, 42);
    expect(result).toMatchObject({ primaryGenre: null, profileVersion: 1 });
    expect(books.findById).toHaveBeenCalledWith(7, 42);
  });

  it("persists a user edit and retries a Book CAS conflict", () => {
    const first = book();
    const concurrent = book();
    const books = fakeBooks(first);
    books.save.mockReturnValueOnce("conflict").mockReturnValueOnce("saved");
    books.findById.mockReturnValueOnce(first).mockReturnValueOnce(concurrent);

    const result = new EditBookReadingProfileUseCase(books).execute(7, 42, {
      primaryGenre: "technical",
      secondaryGenres: ["popular-science"],
      classificationSummary: "User reason",
    });

    expect(result).toMatchObject({
      primaryGenre: "technical",
      confidence: { kind: "user-determined" },
      profileVersion: 2,
    });
    expect(books.save).toHaveBeenCalledTimes(2);
  });

  it("rejects an empty edit and leaves traits outside the writable contract", () => {
    const books = fakeBooks(book());
    expect(() => new EditBookReadingProfileUseCase(books).execute(7, 42, {}))
      .toThrow(expect.objectContaining({ kind: "VALIDATION" }));
    expect(books.save).not.toHaveBeenCalled();
  });

  it("clears a configured profile but does not write an already empty profile", () => {
    const configured = book();
    configured.editReadingProfile({ primaryGenre: "narrative" });
    const books = fakeBooks(configured);
    books.save.mockReturnValue("saved");
    expect(new ClearBookReadingProfileUseCase(books).execute(7, 42)).toMatchObject({
      primaryGenre: null,
      traits: [],
      confidence: null,
      profileVersion: 3,
    });
    expect(books.save).toHaveBeenCalledTimes(1);

    const emptyBooks = fakeBooks(book());
    new ClearBookReadingProfileUseCase(emptyBooks).execute(7, 42);
    expect(emptyBooks.save).not.toHaveBeenCalled();
  });
});

function book(): Book {
  return Book.rehydrate({
    id: 42,
    ownerId: 7,
    metadata: { title: "Book", authors: ["Author"] },
    sourceReferences: [],
    readingProfile: {
      id: "profile-42",
      primaryGenre: null,
      secondaryGenres: [],
      traits: [],
      confidence: null,
      classificationSummary: null,
      profileVersion: 1,
      updatedAt: "2026-08-27T00:00:00.000Z",
    },
    version: 1,
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
  });
}

function fakeBooks(value: Book): jest.Mocked<BookRepositoryPort> {
  return {
    isOwnedBy: jest.fn(),
    findById: jest.fn().mockReturnValue(value),
    insert: jest.fn(),
    save: jest.fn().mockReturnValue("saved"),
    delete: jest.fn(),
    findOwnedIds: jest.fn(),
    deleteMany: jest.fn(),
  };
}
