import { Book } from "../../domain/book";
import type { BookRepositoryPort } from "../ports/book-repository.port";
import { ApplyBookReadingProfileCandidateUseCase } from "./apply-book-reading-profile-candidate.use-case";

const REVISION = {
  fileChecksum: "sha256:book-v1",
  extractorVersion: "epub-extractor-v4",
  normalizationVersion: "epub-text-v1",
};

describe("ApplyBookReadingProfileCandidateUseCase", () => {
  it("loads and saves the formal profile only through the Book repository", () => {
    const book = makeBook();
    const books = makeBooks(book);
    const profile = new ApplyBookReadingProfileCandidateUseCase(books).apply(
      7,
      42,
      candidate(1),
      REVISION,
      false,
    );

    expect(profile).toMatchObject({ primaryGenre: "technical", profileVersion: 2 });
    expect(books.save).toHaveBeenCalledWith(book, 1);
  });

  it("accepts an equivalent candidate without issuing a spurious Book save", () => {
    const book = makeBook();
    book.applyAnalysisCandidate(candidate(1), REVISION, false);
    const books = makeBooks(book);

    expect(new ApplyBookReadingProfileCandidateUseCase(books).apply(
      7,
      42,
      candidate(2),
      REVISION,
      false,
    )).toMatchObject({ primaryGenre: "technical", profileVersion: 2 });
    expect(books.save).not.toHaveBeenCalled();
  });
});

function candidate(baseProfileVersion: number) {
  return {
    candidateId: "candidate-1",
    bookId: 42,
    baseProfileVersion,
    primaryGenre: "technical" as const,
    secondaryGenres: [],
    traits: ["linear"],
    confidence: 0.9,
    classificationSummary: "A technical structure.",
    contentRevision: REVISION,
    modelId: "deepseek-v4-flash",
    strategyVersion: "book-profile-v1",
    analyzedAt: "2026-08-27T00:00:00.000Z",
  };
}

function makeBook(): Book {
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

function makeBooks(book: Book): jest.Mocked<BookRepositoryPort> {
  return {
    isOwnedBy: jest.fn(),
    findById: jest.fn().mockReturnValue(book),
    insert: jest.fn(),
    save: jest.fn().mockReturnValue("saved"),
    delete: jest.fn(),
    findOwnedIds: jest.fn(),
    deleteMany: jest.fn(),
  };
}
