import { GetReadingStateUseCase } from "./get-reading-state.use-case";

describe("GetReadingStateUseCase", () => {
  it("returns one authoritative snapshot for progress, bookmarks, and annotations", () => {
    const progress = { findByUserBook: jest.fn().mockReturnValue({ location: "cfi-1" }) };
    const bookmarks = { listByUserBook: jest.fn().mockReturnValue([{ id: 2 }]) };
    const annotations = { findByBook: jest.fn().mockReturnValue([{ id: "a1", revision: 1 }]) };
    const versions = { getRevision: jest.fn().mockReturnValue(9) };
    const ownership = { isOwnedByUser: jest.fn().mockReturnValue(true) };
    const useCase = new GetReadingStateUseCase(
      progress as never,
      bookmarks as never,
      annotations as never,
      versions as never,
      ownership as never,
    );

    expect(useCase.execute(4, 12)).toEqual({
      revision: 9,
      progress: { location: "cfi-1" },
      bookmarks: [{ id: 2 }],
      annotations: [{ id: "a1", revision: 1 }],
    });
    expect(progress.findByUserBook).toHaveBeenCalledWith(4, 12);
  });

  it("fails closed when the book is not owned by the user", () => {
    const ownership = { isOwnedByUser: jest.fn().mockReturnValue(false) };
    const useCase = new GetReadingStateUseCase({} as never, {} as never, {} as never, {} as never, ownership as never);
    expect(() => useCase.execute(4, 99)).toThrow(expect.objectContaining({ code: "BOOK_NOT_FOUND" }));
  });
});
