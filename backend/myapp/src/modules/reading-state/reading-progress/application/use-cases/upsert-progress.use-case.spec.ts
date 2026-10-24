import { UpsertProgressUseCase } from "./upsert-progress.use-case";
import type { BookOwnershipPort } from "../../../../intelligent-library/public";
import type { ReadingProgressRepositoryPort } from "../ports/reading-progress-repository.port";

// C9 编号对应 doc/同步测试用例审查.md
describe("UpsertProgressUseCase", () => {
  let useCase: UpsertProgressUseCase;
  const mockRepo = {
    upsert: jest.fn(),
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
    useCase = new UpsertProgressUseCase(
      mockRepo as unknown as ReadingProgressRepositoryPort,
      mockBookOwnership as unknown as BookOwnershipPort,
      mockChanges,
    );
  });

  const baseInput = {
    bookId: 7,
    bookHash: "",
    location: "epubcfi(/6/4!/4/2)",
    locationType: "epubcfi" as const,
    deviceId: "dev-1",
    deviceSequence: 1,
  };

  it("clamps fraction into [0,1] and injects userId + server time", () => {
    mockRepo.upsert.mockImplementation((x) => ({ progress: x, changed: true }));
    useCase.execute(3, { ...baseInput, fraction: 1.7 });
    const arg = mockRepo.upsert.mock.calls[0][0];
    expect(arg.userId).toBe(3);
    expect(arg.fraction).toBe(1);
    expect(arg.now).toBeGreaterThan(0);
  });

  it("floors negative / NaN fraction to 0", () => {
    mockRepo.upsert.mockImplementation((x) => ({ progress: x, changed: true }));
    useCase.execute(3, { ...baseInput, fraction: -0.5 });
    expect(mockRepo.upsert.mock.calls[0][0].fraction).toBe(0);

    useCase.execute(3, { ...baseInput, fraction: NaN });
    expect(mockRepo.upsert.mock.calls[1][0].fraction).toBe(0);
  });

  it("passes valid fraction through unchanged", () => {
    mockRepo.upsert.mockImplementation((x) => ({ progress: x, changed: true }));
    useCase.execute(3, { ...baseInput, fraction: 0.42 });
    expect(mockRepo.upsert.mock.calls[0][0].fraction).toBe(0.42);
  });

  it("throws notFound and does not write when book is not owned by user", () => {
    mockBookOwnership.isOwnedByUser.mockReturnValue(false);
    expect(() => useCase.execute(3, { ...baseInput, fraction: 0.5 })).toThrow(
      expect.objectContaining({ code: "BOOK_NOT_FOUND" }),
    );
    expect(mockBookOwnership.isOwnedByUser).toHaveBeenCalledWith({ userId: 3, bookId: 7 });
    expect(mockRepo.upsert).not.toHaveBeenCalled();
  });

  it("C9 同一设备发来设备序号更小的进度 → 拒绝，进度不倒退，也不通知其他设备", () => {
    let mutationResult: { value: unknown; didChange: boolean; bookId: number | null } | undefined;
    const changes = {
      transact: jest.fn((_input, mutation) => {
        mutationResult = mutation();
        return mutationResult!.value;
      }),
    };
    mockRepo.upsert.mockReturnValue({
      changed: false,
      progress: { bookId: 7, deviceId: "dev-1", deviceSequence: 4, revision: 4 },
    });
    useCase = new UpsertProgressUseCase(
      mockRepo as unknown as ReadingProgressRepositoryPort,
      mockBookOwnership as unknown as BookOwnershipPort,
      changes as never,
    );

    const result = useCase.execute(3, { ...baseInput, deviceSequence: 3, fraction: 0.5 });
    expect(result.deviceSequence).toBe(4);
    expect(changes.transact).toHaveBeenCalledTimes(1);
    // 协调器只在 didChange 为 true 时推进版本号并通知（见 C5）。
    expect(mutationResult).toMatchObject({ didChange: false, bookId: 7 });
  });
});
