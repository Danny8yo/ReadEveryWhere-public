import { CreateBookmarkUseCase } from "./create-bookmark.use-case";
import type { BookOwnershipPort } from "../../../../intelligent-library/public";
import type { BookmarkRepositoryPort } from "../ports/bookmark-repository.port";

describe("CreateBookmarkUseCase", () => {
  let useCase: CreateBookmarkUseCase;
  const mockRepo = {
    create: jest.fn(),
  };
  const mockBookOwnership = {
    isOwnedByUser: jest.fn(),
  };
  const mockChanges = {
    transact: jest.fn((_input, mutation) => mutation().value),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // 默认：书归当前用户所有，归属校验通过。
    mockBookOwnership.isOwnedByUser.mockReturnValue(true);
    useCase = new CreateBookmarkUseCase(
      mockRepo as unknown as BookmarkRepositoryPort,
      mockBookOwnership as unknown as BookOwnershipPort,
      mockChanges,
    );
  });

  const baseInput = {
    bookId: 7,
    bookHash: "",
    location: "epubcfi(/6/4!/4/2)",
    locationType: "epubcfi" as const,
    chapterLabel: "第一章",
  };

  it("clamps fraction into [0,1] and injects userId + server time", () => {
    mockRepo.create.mockImplementation((x) => ({ bookmark: x, created: true }));
    useCase.execute(3, { ...baseInput, fraction: 1.7 });
    const arg = mockRepo.create.mock.calls[0][0];
    expect(arg.userId).toBe(3);
    expect(arg.fraction).toBe(1);
    expect(arg.now).toBeGreaterThan(0);
  });

  it("floors negative / NaN fraction to 0", () => {
    mockRepo.create.mockImplementation((x) => ({ bookmark: x, created: true }));
    useCase.execute(3, { ...baseInput, fraction: -0.5 });
    expect(mockRepo.create.mock.calls[0][0].fraction).toBe(0);

    useCase.execute(3, { ...baseInput, fraction: NaN });
    expect(mockRepo.create.mock.calls[1][0].fraction).toBe(0);
  });

  it("passes valid fraction and chapterLabel through unchanged", () => {
    mockRepo.create.mockImplementation((x) => ({ bookmark: x, created: true }));
    useCase.execute(3, { ...baseInput, fraction: 0.42 });
    const arg = mockRepo.create.mock.calls[0][0];
    expect(arg.fraction).toBe(0.42);
    expect(arg.chapterLabel).toBe("第一章");
  });

  it("throws notFound and does not write when book is not owned by user", () => {
    mockBookOwnership.isOwnedByUser.mockReturnValue(false);
    expect(() => useCase.execute(3, { ...baseInput, fraction: 0.5 })).toThrow(
      expect.objectContaining({ code: "BOOK_NOT_FOUND" }),
    );
    expect(mockBookOwnership.isOwnedByUser).toHaveBeenCalledWith({ userId: 3, bookId: 7 });
    expect(mockRepo.create).not.toHaveBeenCalled();
  });
});
