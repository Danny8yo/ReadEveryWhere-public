import { BookAnalysisError } from "../../domain/book-analysis.error";
import { BookAnalysisTask } from "../../domain/book-analysis-task";
import type { BookAnalysisContentPort } from "../ports/book-analysis-content.port";
import type { BookAnalysisLibraryPort } from "../ports/book-analysis-library.port";
import type { BookAnalysisModelCapabilityPort } from "../ports/book-analysis-model-capability.port";
import type {
  BookAnalysisModelConfigPort,
  BookAnalysisModelCredential,
} from "../ports/book-analysis-model-config.port";
import type { BookAnalysisStorePort } from "../ports/book-analysis-store.port";
import { BatchBookAnalysisUseCase } from "./batch-book-analysis.use-case";
import { GetBookAnalysisUseCase } from "./get-book-analysis.use-case";
import { RequestBookAnalysisUseCase } from "./request-book-analysis.use-case";

const REVISION = {
  fileChecksum: "sha256:v1",
  extractorVersion: "epub-1",
  normalizationVersion: "text-1",
};

function requestFixture() {
  const books: jest.Mocked<BookAnalysisLibraryPort> = {
    findOwnedAnalysisSource: jest.fn().mockReturnValue({
      bookId: 42,
      userId: 7,
      fileName: "book.epub",
      mimeType: "application/epub+zip",
      downloadStatus: "completed",
    }),
    requireOwned: jest.fn(),
  };
  const content: jest.Mocked<Pick<BookAnalysisContentPort, "currentRevision">> = {
    currentRevision: jest.fn().mockResolvedValue(REVISION),
  };
  const modelConfigs: jest.Mocked<BookAnalysisModelConfigPort> = {
    getCredential: jest.fn().mockReturnValue({
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
      apiKey: "test-key",
    }),
  };
  const store: jest.Mocked<Pick<BookAnalysisStorePort, "getSnapshot" | "enqueueIfAbsent">> = {
    getSnapshot: jest.fn().mockReturnValue({
      status: "not_analyzed",
      stale: false,
      candidate: null,
      errorCode: null,
    }),
    enqueueIfAbsent: jest.fn((task) => ({ created: true, task })),
  };
  const modelCapabilities: jest.Mocked<BookAnalysisModelCapabilityPort> = {
    supportsStrictTools: jest.fn((credential: Readonly<BookAnalysisModelCredential>): boolean => (
      credential.modelId !== "deepseek-reasoner"
    )),
  };
  const useCase = new RequestBookAnalysisUseCase(
    books,
    content,
    modelConfigs,
    store,
    { strategyVersion: "book-profile-v1" },
    modelCapabilities,
    {
      idFactory: jest.fn().mockReturnValue("task-1"),
      now: jest.fn().mockReturnValue("2026-08-08T00:00:00.000Z"),
    },
  );
  return { useCase, books, content, modelConfigs, store, modelCapabilities };
}

describe("RequestBookAnalysisUseCase", () => {
  it("同一本书同 revision/策略的重复提交原子幂等", async () => {
    const fixture = requestFixture();
    const task = pendingTask();
    fixture.store.enqueueIfAbsent
      .mockReturnValueOnce({ created: true, task })
      .mockReturnValueOnce({ created: false, task });

    await expect(fixture.useCase.execute(7, { bookId: 42, force: false })).resolves.toEqual({
      bookId: 42,
      disposition: "accepted",
      status: "pending",
      taskId: "task-1",
      reason: null,
    });
    await expect(fixture.useCase.execute(7, { bookId: 42, force: false })).resolves.toEqual({
      bookId: 42,
      disposition: "skipped",
      status: "pending",
      taskId: "task-1",
      reason: "ALREADY_QUEUED",
    });
  });

  it("有效 ready 默认跳过，force=true 才重新入队", async () => {
    const fixture = requestFixture();
    fixture.store.getSnapshot.mockReturnValue({
      status: "ready",
      stale: false,
      candidate: null,
      errorCode: null,
    });

    await expect(fixture.useCase.execute(7, { bookId: 42, force: false })).resolves.toMatchObject({
      disposition: "skipped", status: "ready", reason: "ANALYSIS_CURRENT",
    });
    expect(fixture.store.enqueueIfAbsent).not.toHaveBeenCalled();

    await expect(fixture.useCase.execute(7, { bookId: 42, force: true })).resolves.toMatchObject({
      disposition: "accepted", status: "pending",
    });
  });

  it.each([
    ["越权书籍", null, "BOOK_NOT_FOUND"],
    ["缺少文件", { bookId: 42, userId: 7, fileName: null, mimeType: null, downloadStatus: null }, "BOOK_FILE_MISSING"],
    ["非 EPUB", { bookId: 42, userId: 7, fileName: "book.pdf", mimeType: "application/pdf", downloadStatus: "completed" }, "UNSUPPORTED_FORMAT"],
  ])("拒绝%s并返回明确原因", async (_name, source, reason) => {
    const fixture = requestFixture();
    fixture.books.findOwnedAnalysisSource.mockReturnValue(source);

    await expect(fixture.useCase.execute(7, { bookId: 42, force: false })).rejects.toMatchObject({
      reason,
    });
    expect(fixture.store.enqueueIfAbsent).not.toHaveBeenCalled();
  });

  it("未配置 AI Key 时不创建任务", async () => {
    const fixture = requestFixture();
    fixture.modelConfigs.getCredential.mockReturnValue(null);

    await expect(fixture.useCase.execute(7, { bookId: 42, force: false })).rejects.toMatchObject({
      reason: "AI_MODEL_NOT_CONFIGURED",
    });
  });

  it("reasoning 模型不进入依赖 Tool 的书籍预分析", async () => {
    const fixture = requestFixture();
    fixture.modelConfigs.getCredential.mockReturnValue({
      provider: "deepseek",
      modelId: "deepseek-reasoner",
      apiKey: "test-key",
    });

    await expect(fixture.useCase.execute(7, { bookId: 42, force: false })).rejects.toMatchObject({
      reason: "AI_MODEL_UNSUPPORTED",
    });
    expect(fixture.content.currentRevision).not.toHaveBeenCalled();
    expect(fixture.store.enqueueIfAbsent).not.toHaveBeenCalled();
  });

  it("能力目录的内部缺陷直接传播，不伪装成模型不支持", async () => {
    const fixture = requestFixture();
    const defect = new Error("capability registry corrupted");
    fixture.modelCapabilities.supportsStrictTools.mockImplementation(() => {
      throw defect;
    });

    await expect(fixture.useCase.execute(7, { bookId: 42, force: false })).rejects.toBe(defect);
  });
});

describe("BatchBookAnalysisUseCase", () => {
  it("对 ID 去重并把单本失败转换为 rejected，不中止其他书", async () => {
    const execute: jest.MockedFunction<RequestBookAnalysisUseCase["execute"]> = jest.fn(
      async (_userId: number, input: { bookId: number; force: boolean }) => {
        if (input.bookId === 2) {
          throw BookAnalysisError.rejected("BOOK_NOT_FOUND", "not owned");
        }
        return {
          bookId: input.bookId,
          disposition: input.bookId === 3 ? "skipped" as const : "accepted" as const,
          status: input.bookId === 3 ? "ready" : "pending",
          taskId: input.bookId === 3 ? null : `task-${input.bookId}`,
          reason: input.bookId === 3 ? "ANALYSIS_CURRENT" : null,
        };
      },
    );
    const request = { execute };
    const useCase = new BatchBookAnalysisUseCase(request, { maxBatchSize: 50 });

    await expect(useCase.execute(7, { bookIds: [1, 2, 1, 3], force: false })).resolves.toEqual({
      items: [
        expect.objectContaining({ bookId: 1, disposition: "accepted" }),
        { bookId: 2, disposition: "rejected", status: "not_analyzed", taskId: null, reason: "BOOK_NOT_FOUND" },
        expect.objectContaining({ bookId: 3, disposition: "skipped" }),
      ],
    });
    expect(execute).toHaveBeenCalledTimes(3);
    expect(execute.mock.calls).toEqual([
      [7, { bookId: 1, force: false }],
      [7, { bookId: 2, force: false }],
      [7, { bookId: 3, force: false }],
    ]);
  });
});

describe("GetBookAnalysisUseCase", () => {
  it("内容 revision 改变后将历史 ready 画像返回为 stale", async () => {
    const books: jest.Mocked<Pick<
      BookAnalysisLibraryPort,
      "requireOwned" | "findOwnedAnalysisSource"
    >> = {
      requireOwned: jest.fn().mockReturnValue({ id: 42 }),
      findOwnedAnalysisSource: jest.fn().mockReturnValue({
        bookId: 42,
        userId: 7,
        fileName: "book.epub",
        mimeType: "application/epub+zip",
        downloadStatus: "completed",
      }),
    };
    const content: jest.Mocked<Pick<BookAnalysisContentPort, "currentRevision">> = {
      currentRevision: jest.fn().mockResolvedValue({ ...REVISION, fileChecksum: "sha256:v2" }),
    };
    const store: jest.Mocked<Pick<BookAnalysisStorePort, "getSnapshot">> = {
      getSnapshot: jest.fn().mockReturnValue({
        status: "stale", stale: true, candidate: null, errorCode: null,
      }),
    };
    const useCase = new GetBookAnalysisUseCase(
      books,
      content,
      store,
      { strategyVersion: "book-profile-v1" },
    );

    await expect(useCase.execute(7, 42)).resolves.toEqual({
      bookId: 42,
      status: "stale",
      stale: true,
      candidate: null,
      errorCode: null,
    });
    expect(store.getSnapshot).toHaveBeenCalledWith(7, 42, expect.objectContaining({ fileChecksum: "sha256:v2" }), "book-profile-v1");
  });

  it.each([
    [
      "无本地文件",
      { bookId: 42, userId: 7, fileName: null, mimeType: null, downloadStatus: null },
      "not_analyzed",
    ],
    [
      "非 EPUB",
      { bookId: 42, userId: 7, fileName: "book.pdf", mimeType: "application/pdf", downloadStatus: "completed" },
      "unsupported",
    ],
  ])("查询%s时返回明确状态且不读取正文", async (_name, source, status) => {
    const books: jest.Mocked<Pick<
      BookAnalysisLibraryPort,
      "requireOwned" | "findOwnedAnalysisSource"
    >> = {
      requireOwned: jest.fn().mockReturnValue({ id: 42 }),
      findOwnedAnalysisSource: jest.fn().mockReturnValue(source),
    };
    const content: jest.Mocked<Pick<BookAnalysisContentPort, "currentRevision">> = {
      currentRevision: jest.fn(),
    };
    const store: jest.Mocked<Pick<BookAnalysisStorePort, "getSnapshot">> = {
      getSnapshot: jest.fn(),
    };
    const useCase = new GetBookAnalysisUseCase(
      books,
      content,
      store,
      { strategyVersion: "book-profile-v1" },
    );

    await expect(useCase.execute(7, 42)).resolves.toEqual({
      bookId: 42,
      status,
      stale: false,
      candidate: null,
      errorCode: null,
    });
    expect(content.currentRevision).not.toHaveBeenCalled();
    expect(store.getSnapshot).not.toHaveBeenCalled();
  });
});

function pendingTask(): BookAnalysisTask {
  return BookAnalysisTask.create({
    id: "task-1",
    userId: 7,
    bookId: 42,
    contentRevision: REVISION,
    modelId: "deepseek-v4-flash",
    strategyVersion: "book-profile-v1",
    requestedAt: "2026-08-08T00:00:00.000Z",
  });
}
