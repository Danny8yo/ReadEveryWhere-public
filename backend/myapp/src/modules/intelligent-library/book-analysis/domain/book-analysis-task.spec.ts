import { BookAnalysisDomainError } from "./book-reading-profile-candidate";
import { BookAnalysisTask } from "./book-analysis-task";

const NOW = "2026-08-08T00:00:00.000Z";
const LATER = "2026-08-08T00:01:00.000Z";

function createTask() {
  return BookAnalysisTask.create({
    id: "analysis-task-1",
    userId: 7,
    bookId: 42,
    contentRevision: {
      fileChecksum: "sha256:book-v1",
      extractorVersion: "epub-1",
      normalizationVersion: "text-1",
    },
    modelId: "deepseek-v4-flash",
    strategyVersion: "book-profile-v1",
    requestedAt: NOW,
  });
}

describe("BookAnalysisTask", () => {
  it("按 pending -> running -> ready 转换并冻结终态", () => {
    const task = createTask();
    expect(task.status).toBe("pending");

    task.start(LATER);
    expect(task.status).toBe("running");
    task.complete("profile-1", "2026-08-08T00:02:00.000Z");
    expect(task.status).toBe("ready");
    expect(task.toJSON()).toMatchObject({ profileId: "profile-1", errorCode: null });
    expect(() => task.fail("CLASSIFICATION_TIMEOUT", LATER)).toThrow(
      expect.objectContaining({ code: "ANALYSIS_TASK_TRANSITION_INVALID" }),
    );
  });

  it("running 可进入 failed，失败只保存稳定错误码而不保存上游响应", () => {
    const task = createTask();
    task.start(LATER);
    task.fail("CLASSIFICATION_SCHEMA_INVALID", "2026-08-08T00:02:00.000Z");

    expect(task.status).toBe("failed");
    expect(task.toJSON()).toMatchObject({
      errorCode: "CLASSIFICATION_SCHEMA_INVALID",
      profileId: null,
    });
    expect(task.toJSON()).not.toHaveProperty("upstreamResponse");
    expect(task.toJSON()).not.toHaveProperty("prompt");
  });

  it("拒绝跳过 running 或从终态恢复运行", () => {
    const task = createTask();
    expect(() => task.complete("profile-1", LATER)).toThrow(
      expect.objectContaining({ code: "ANALYSIS_TASK_TRANSITION_INVALID" }),
    );

    task.start(LATER);
    task.fail("CLASSIFICATION_TIMEOUT", LATER);
    expect(() => task.start(LATER)).toThrow(
      expect.objectContaining({ code: "ANALYSIS_TASK_TRANSITION_INVALID" }),
    );
  });

  it("序列化恢复后保持状态、revision、模型和策略版本", () => {
    const task = createTask();
    task.start(LATER);

    expect(BookAnalysisTask.fromJSON(task.toJSON()).toJSON()).toEqual(task.toJSON());
  });
});
