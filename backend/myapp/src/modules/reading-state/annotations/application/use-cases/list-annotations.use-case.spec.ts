import { ListAnnotationsUseCase } from "./list-annotations.use-case";
import type { AnnotationRepositoryPort } from "../ports/annotation-repository.port";

describe("ListAnnotationsUseCase", () => {
  let useCase: ListAnnotationsUseCase;
  const mockRepo = {
    findByBook: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    useCase = new ListAnnotationsUseCase(mockRepo as unknown as AnnotationRepositoryPort);
  });

  it("returns active annotations for a book", () => {
    mockRepo.findByBook.mockReturnValue([
      { id: "a1", annotationType: "highlight" },
      { id: "a2", annotationType: "underline" },
    ]);

    const results = useCase.execute(1, { userId: 1, bookId: 1 });
    expect(results).toHaveLength(2);
    expect(mockRepo.findByBook).toHaveBeenCalledWith(1, 1);
  });

  it("filters by type when specified", () => {
    const all = [{ id: "a1", annotationType: "highlight" }, { id: "a2", annotationType: "underline" }];
    mockRepo.findByBook.mockReturnValue(all);

    const results = useCase.execute(1, { userId: 1, bookId: 1, type: "highlight" });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("a1");
  });

  it("filters by hasNote when specified", () => {
    const all = [
      { id: "a1", annotationType: "highlight", note: "hello" },
      { id: "a2", annotationType: "underline", note: null },
    ];
    mockRepo.findByBook.mockReturnValue(all);

    const withNote = useCase.execute(1, { userId: 1, bookId: 1, hasNote: true });
    expect(withNote).toHaveLength(1);
    expect(withNote[0].id).toBe("a1");

    const withoutNote = useCase.execute(1, { userId: 1, bookId: 1, hasNote: false });
    expect(withoutNote).toHaveLength(1);
    expect(withoutNote[0].id).toBe("a2");
  });
});
