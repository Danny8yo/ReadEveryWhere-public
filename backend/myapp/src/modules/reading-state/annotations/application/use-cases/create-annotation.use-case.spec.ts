import { CreateAnnotationUseCase } from "./create-annotation.use-case";
import type { AnnotationRepositoryPort } from "../ports/annotation-repository.port";
import type { BookOwnershipPort } from "../../../../intelligent-library/public";

describe("CreateAnnotationUseCase", () => {
  let useCase: CreateAnnotationUseCase;
  const mockRepo = {
    findByIdempotencyKey: jest.fn(),
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
    useCase = new CreateAnnotationUseCase(
      mockRepo as unknown as AnnotationRepositoryPort,
      mockBookOwnership as unknown as BookOwnershipPort,
      mockChanges,
    );
  });

  const now = Date.now();

  it("creates new annotation when no duplicate exists", () => {
    mockRepo.findByIdempotencyKey.mockReturnValue(null);
    mockRepo.create.mockReturnValue({ id: "new-id", bookId: 1 });

    const input = {
      bookId: 1,
      bookHash: "sha256:abc",
      annotationType: "highlight" as const,
      color: "#ffeb3b",
      location: "epubcfi(/6/4!/4/2/1:0)",
      locationType: "epubcfi" as const,
      textContent: "测试",
      contextBefore: null,
      contextAfter: null,
      chapterLabel: null,
      sortKey: 1.0,
      note: null,
    };

    const result = useCase.execute(1, input);
    expect(mockRepo.create).toHaveBeenCalledTimes(1);
    expect(result.id).toBe("new-id");
  });

  it("returns existing annotation when idempotent duplicate is found within 5s", () => {
    const existing = { id: "existing-id", updatedAt: now - 2000, note: null, annotationType: "highlight", color: "#ffeb3b" };
    mockRepo.findByIdempotencyKey.mockReturnValue(existing);

    const result = useCase.execute(1, {
      bookId: 1,
      bookHash: "sha256:abc",
      annotationType: "highlight" as const,
      color: "#ffeb3b",
      location: "epubcfi(/6/4!/4/2/1:0)",
      locationType: "epubcfi" as const,
      textContent: "测试",
      contextBefore: null,
      contextAfter: null,
      chapterLabel: null,
      sortKey: 1.0,
      note: null,
    });

    expect(mockRepo.create).not.toHaveBeenCalled();
    expect(result.id).toBe("existing-id");
  });

  it("creates new annotation when duplicate is outside 5s window", () => {
    const existing = { id: "old-id", updatedAt: now - 10000 };
    mockRepo.findByIdempotencyKey.mockReturnValue(existing);
    mockRepo.create.mockReturnValue({ id: "new-id", bookId: 1 });

    const result = useCase.execute(1, {
      bookId: 1,
      bookHash: "sha256:abc",
      annotationType: "highlight" as const,
      color: "#ffeb3b",
      location: "epubcfi(/6/4!/4/2/1:0)",
      locationType: "epubcfi" as const,
      textContent: "测试",
      contextBefore: null,
      contextAfter: null,
      chapterLabel: null,
      sortKey: 1.0,
      note: null,
    });

    expect(mockRepo.create).toHaveBeenCalled();
    expect(result.id).toBe("new-id");
  });


  it("does not swallow a different note at the same anchor within five seconds", () => {
    mockRepo.findByIdempotencyKey.mockReturnValue({ id: 'old', updatedAt: Date.now(), note: '旧笔记', annotationType: 'highlight', color: '#ffeb3b' });
    mockRepo.create.mockReturnValue({ id: 'new' });
    const result = useCase.execute(1, { bookId: 1, bookHash: 'hash', annotationType: 'highlight', color: '#ffeb3b', location: 'epubcfi(/6/2!/4/2)', locationType: 'epubcfi', textContent: '原文', note: '新笔记', contextBefore: null, contextAfter: null, chapterLabel: null, sortKey: null });
    expect(result.id).toBe('new');
    expect(mockRepo.create).toHaveBeenCalledTimes(1);
  });

  it("throws notFound and does not write when book is not owned by user", () => {
    mockBookOwnership.isOwnedByUser.mockReturnValue(false);
    expect(() =>
      useCase.execute(1, {
        bookId: 99,
        bookHash: "sha256:abc",
        annotationType: "highlight" as const,
        color: "#ffeb3b",
        location: "epubcfi(/6/4!/4/2/1:0)",
        locationType: "epubcfi" as const,
        textContent: "测试",
        contextBefore: null,
        contextAfter: null,
        chapterLabel: null,
        sortKey: 1.0,
        note: null,
      }),
    ).toThrow();
    expect(mockBookOwnership.isOwnedByUser).toHaveBeenCalledWith({ userId: 1, bookId: 99 });
    expect(mockRepo.create).not.toHaveBeenCalled();
    expect(mockRepo.findByIdempotencyKey).not.toHaveBeenCalled();
  });
});
