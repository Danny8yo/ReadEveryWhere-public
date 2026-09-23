import { UpdateAnnotationUseCase } from "./update-annotation.use-case";
import type { AnnotationRepositoryPort } from "../ports/annotation-repository.port";
import { ReadingStateError } from "../../../domain/reading-state.error";

describe("UpdateAnnotationUseCase", () => {
  let useCase: UpdateAnnotationUseCase;
  const mockRepo = {
    findById: jest.fn(),
    updateAnnotation: jest.fn(),
  };
  const mockChanges = {
    transact: jest.fn((_input, mutation) => mutation().value),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    useCase = new UpdateAnnotationUseCase(
      mockRepo as unknown as AnnotationRepositoryPort,
      mockChanges,
    );
  });

  it("updates annotation color and note", () => {
    mockRepo.findById.mockReturnValue({ id: "a1", userId: 1, revision: 4 });
    mockRepo.updateAnnotation.mockReturnValue({
      kind: "updated",
      annotation: { id: "a1", bookId: 7, color: "#a5d6a7", note: "updated", revision: 5 },
    });

    const result = useCase.execute(1, "a1", { revision: 4, color: "#a5d6a7", note: "updated" });
    expect(result.color).toBe("#a5d6a7");
    expect(result.revision).toBe(5);
    expect(mockRepo.updateAnnotation).toHaveBeenCalledWith(expect.objectContaining({
      annotationId: "a1",
      expectedRevision: 4,
    }));
  });

  it("throws not found for non-existent annotation", () => {
    mockRepo.updateAnnotation.mockReturnValue({ kind: "not_found" });
    expect(() => useCase.execute(1, "bad-id", { revision: 1, color: "#fff" }))
      .toThrow(ReadingStateError);
  });

  it("throws not found for annotation belonging to another user", () => {
    mockRepo.updateAnnotation.mockReturnValue({ kind: "not_found" });
    expect(() => useCase.execute(1, "a1", { revision: 1, color: "#fff" }))
      .toThrow(ReadingStateError);
  });

  it("returns existing annotation when all fields are undefined", () => {
    const existing = { id: "a1", userId: 1, color: "#ff0", note: "hello", revision: 2 };
    mockRepo.findById.mockReturnValue(existing);
    mockRepo.updateAnnotation.mockReturnValue({ kind: "updated", annotation: existing });

    const result = useCase.execute(1, "a1", { revision: 2 });
    expect(result).toEqual(existing);
  });

  it("throws a revision conflict instead of silently overwriting", () => {
    mockRepo.updateAnnotation.mockReturnValue({
      kind: "conflict",
      current: { id: "a1", userId: 1, revision: 5, note: "server" },
    });

    expect(() => useCase.execute(1, "a1", { revision: 4, note: "client" }))
      .toThrow(expect.objectContaining({
        code: "ANNOTATION_CONFLICT",
        current: expect.objectContaining({ revision: 5, note: "server" }),
      }));
    expect(mockRepo.updateAnnotation).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 4 }));
  });
});
