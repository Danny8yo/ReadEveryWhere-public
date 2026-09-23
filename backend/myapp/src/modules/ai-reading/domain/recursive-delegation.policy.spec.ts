import { RecursiveDelegationPolicy, goalFingerprint, goalsAreNearDuplicates } from "./recursive-delegation.policy";

describe("RecursiveDelegationPolicy", () => {
  const policy = new RecursiveDelegationPolicy({
    schemaVersion: 1,
    maxDepth: 2,
    maxChildrenPerParent: 3,
    maxDelegatedPerDepth: 3,
  });

  it("allows a child to delegate grandchildren but rejects depth three", () => {
    expect(() => policy.assertDepth(0, 1)).not.toThrow();
    expect(() => policy.assertDepth(1, 2)).not.toThrow();
    expect(() => policy.assertDepth(2, 3)).toThrow(expect.objectContaining({ code: "DELEGATION_DEPTH_EXCEEDED" }));
  });

  it("normalizes punctuation and detects containment and bigram duplicates", () => {
    expect(goalFingerprint(" 分析：第一章的核心论证！ ")).toBe(goalFingerprint("分析第一章的核心论证"));
    expect(goalsAreNearDuplicates("分析第一章的核心论证和作者证据", "第一章的核心论证和作者证据")).toBe(true);
    expect(goalsAreNearDuplicates("核对作者对技术进步的判断依据", "梳理附录中的人物关系变化")).toBe(false);
  });

  it("rejects malformed subtasks and duplicate goals in one batch", () => {
    expect(() => policy.validateSubtasks([
      { goal: "太短", deliverable: "同样太短" },
    ], [])).toThrow(expect.objectContaining({ code: "DELEGATION_SUBTASK_INVALID" }));
    expect(() => policy.validateSubtasks([
      { goal: "分析第一章中作者给出的主要判断依据", deliverable: "列出判断和对应证据" },
      { goal: "分析第一章中作者给出的主要判断依据！", deliverable: "换一种格式列出判断证据" },
    ], [])).toThrow(expect.objectContaining({ code: "DELEGATION_DUPLICATE_GOAL" }));
  });

  it("rejects ancestor loops, a second delegation and per-depth overflow", () => {
    expect(() => policy.validateSubtasks([
      { goal: "继续分析整本书的核心论点和关键证据", deliverable: "返回整书核心结论和证据" },
    ], ["分析整本书的核心论点和关键证据"])).toThrow(expect.objectContaining({ code: "DELEGATION_CYCLE_DETECTED" }));
    expect(() => policy.assertParentCapacity(1, 1)).toThrow(expect.objectContaining({ code: "DELEGATION_ALREADY_PERFORMED" }));
    expect(() => policy.assertLayerCapacity(2, 2)).toThrow(expect.objectContaining({ code: "DELEGATION_LAYER_EXCEEDED" }));
  });
});
