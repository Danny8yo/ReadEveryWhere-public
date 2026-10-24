import { GetReadingStateUseCase } from "./get-reading-state.use-case";

// 编号对应 doc/同步测试用例审查.md
describe("笔记快照（GetReadingStateUseCase）", () => {
  it("C6 打开书时一次拿到进度、书签、笔记和当前版本号", () => {
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

  it("C7 请求别人的书 → 报书不存在", () => {
    const ownership = { isOwnedByUser: jest.fn().mockReturnValue(false) };
    const useCase = new GetReadingStateUseCase({} as never, {} as never, {} as never, {} as never, ownership as never);
    expect(() => useCase.execute(4, 99)).toThrow(expect.objectContaining({ code: "BOOK_NOT_FOUND" }));
  });
});
