import { AgentRun } from "./agent-run";
import { BookScope } from "./book-scope";

const scope = BookScope.create({ userId: "1", bookId: "11", contentRevision: "revision-1" });
const now = "2026-08-16T00:00:00.000Z";

describe("AgentRun recursive lifecycle", () => {
  it("persists a depth-two tree node and waits for children before resuming", () => {
    const root = AgentRun.createRoot({ id: "root", taskId: "task", goal: "分析整本书的核心论点和关键证据", scope, now });
    const child = root.createChild({ id: "child", subgoal: "分析第一章中作者提出的核心判断依据",
      deliverable: "返回判断、证据和未决问题", contextEvidenceIds: [], maxDepth: 2, now });
    child.start("2026-08-16T00:00:01.000Z");
    const grandchild = child.createChild({ id: "grandchild", subgoal: "核对第一章案例对核心判断的支持程度",
      deliverable: "返回案例证据和支持强度", contextEvidenceIds: ["e-1"], maxDepth: 2,
      now: "2026-08-16T00:00:02.000Z" });

    child.waitForChildren("2026-08-16T00:00:03.000Z");
    expect(child.status).toBe("waiting_children");
    child.resumeAfterChildren("2026-08-16T00:00:04.000Z");
    expect(child.status).toBe("queued");
    child.start("2026-08-16T00:00:05.000Z");

    expect(AgentRun.fromJSON(grandchild.toJSON())).toMatchObject({
      depth: 2,
      deliverable: "返回案例证据和支持强度",
      contextEvidenceIds: ["e-1"],
    });
  });

  it("lets any non-root node return structured results and treats waiting as active", () => {
    const root = AgentRun.createRoot({ id: "root", taskId: "task", goal: "分析整本书的核心论点和关键证据", scope, now });
    const child = root.createChild({ id: "child", subgoal: "分析第一章中作者提出的核心判断依据",
      deliverable: "返回判断、证据和未决问题", contextEvidenceIds: [], maxDepth: 2, now });
    child.start("2026-08-16T00:00:01.000Z");
    child.waitForChildren("2026-08-16T00:00:02.000Z");
    expect(child.isActive).toBe(true);
    child.resumeAfterChildren("2026-08-16T00:00:03.000Z");
    child.start("2026-08-16T00:00:04.000Z");
    child.completeSubtask({ findings: [], evidenceIds: [], openQuestions: [],
      usage: { modelTurns: 1, toolCalls: 0, readCharacters: 0 } }, "2026-08-16T00:00:05.000Z");
    expect(child.status).toBe("completed");
  });
});
