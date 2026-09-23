import { RollingReadingState } from "./rolling-reading-state";

describe("RollingReadingState", () => {
  const startLocator = locator(3, 0, 0);
  const endLocator = locator(7, 9_000, 9_000);
  const nextLocator = locator(4, 2_000, 2_000);

  it("keeps navigation targets, continuation, covered ranges, and evidence through repeated checkpoints", () => {
    const state = RollingReadingState.create({
      rootGoal: "read the target range",
      currentPlan: [{ id: "read", description: "read continuously", status: "in_progress" }],
      budget: { remaining: { modelTurns: 8, readCharacters: 40_000 } },
    });
    state.recordNavigation({
      entries: [{ nodeId: "target", startLocator, endLocator }],
    });
    state.recordBookRead({
      output: {
        text: "x".repeat(2_000),
        nextLocator,
        segments: [{ textStart: 0, textEnd: 2_000,
          citation: { chapterPath: "Target", locator: locator(3, 0, 2_000) } }],
      },
      evidenceIds: ["evidence-front"],
    });
    state.updateModelMemory({
      findings: [{ statement: "front finding", evidenceIds: ["evidence-front"] }],
      openQuestions: ["what changes later?"],
    }, new Set(["evidence-front"]));

    const first = state.toCheckpoint();
    const restored = RollingReadingState.fromCheckpoint(first);
    restored.recordBookRead({
      output: {
        text: "y".repeat(2_000),
        nextLocator: locator(4, 4_000, 4_000),
        segments: [{ textStart: 0, textEnd: 2_000,
          citation: { chapterPath: "Target", locator: locator(4, 2_000, 4_000) } }],
      },
      evidenceIds: ["evidence-middle"],
    });
    const second = RollingReadingState.fromCheckpoint(restored.toCheckpoint()).toCheckpoint();

    expect(second).toMatchObject({
      rootGoal: "read the target range",
      targetStartLocator: startLocator,
      targetEndLocator: endLocator,
      currentContinuation: { next: locator(4, 4_000, 4_000) },
      findings: [{ statement: "front finding", evidenceIds: ["evidence-front"] }],
      openQuestions: ["what changes later?"],
    });
    expect(second.coverage.recentRanges).toEqual([
      expect.objectContaining({ sectionIndex: 3, start: 0, end: 2_000 }),
      expect.objectContaining({ sectionIndex: 4, start: 2_000, end: 4_000 }),
    ]);
    expect(second.retainedEvidenceIds).toEqual(["evidence-front", "evidence-middle"]);
  });

  it("rejects model findings that cite evidence outside the ledger-owned set", () => {
    const state = RollingReadingState.create({ rootGoal: "read", currentPlan: [], budget: {} });

    expect(() => state.updateModelMemory({
      findings: [{ statement: "invented", evidenceIds: ["not-owned"] }],
      openQuestions: [],
    }, new Set(["owned"]))).toThrow("READING_STATE_EVIDENCE_NOT_OWNED");
  });

  it("keeps a hard-bounded checkpoint instead of accumulating every ledger evidence ID", () => {
    const state = RollingReadingState.create({ rootGoal: "read", currentPlan: [], budget: {} });

    for (let index = 0; index < 200; index += 1) {
      state.recordBookRead({
        output: {
          text: "x".repeat(1_000),
          nextLocator: locator(0, (index + 1) * 1_000, (index + 1) * 1_000),
          segments: [{
            textStart: 0,
            textEnd: 1_000,
            citation: {
              chapterPath: `Chapter ${index}`,
              locator: locator(index, 0, 1_000),
            },
          }],
        },
        evidenceIds: [`evidence-${index}`],
      });
    }

    const checkpoint = state.toCheckpoint();
    const serialized = JSON.stringify(checkpoint);

    expect(serialized.length).toBeLessThanOrEqual(RollingReadingState.MAX_CHECKPOINT_CHARACTERS);
    expect(checkpoint.coverage.totalCharacters).toBe(200_000);
    expect(checkpoint.coverage.coveredSectionCount).toBe(200);
    expect(checkpoint.retainedEvidenceIds).toHaveLength(RollingReadingState.MAX_RETAINED_EVIDENCE_IDS);
    expect(checkpoint.retainedEvidenceIds[0]).toBe("evidence-0");
    expect(checkpoint.retainedEvidenceIds[checkpoint.retainedEvidenceIds.length - 1]).toBe("evidence-199");
  });

  it("rejects an oversized model-memory update instead of silently dropping cited evidence", () => {
    const state = RollingReadingState.create({ rootGoal: "read", currentPlan: [], budget: {} });
    const findings = Array.from({ length: RollingReadingState.MAX_FINDINGS + 1 }, (_, index) => ({
      statement: `finding-${index}`,
      evidenceIds: [`evidence-${index}`],
    }));
    const owned = new Set(findings.flatMap((finding) => finding.evidenceIds));

    expect(() => state.updateModelMemory({ findings, openQuestions: [] }, owned))
      .toThrow("READING_STATE_LIMIT_EXCEEDED");
  });

  it("replaces a stale pending continuation when the model starts a different reading intent", () => {
    const state = RollingReadingState.create({ rootGoal: "read", currentPlan: [], budget: {} });
    state.recordReadingIntent({
      locator: locator(1, 0, 0),
      endLocator: locator(1, 8_000, 8_000),
      direction: "forward",
    });
    state.recordBookRead({
      output: {
        text: "old",
        nextLocator: locator(1, 4_000, 4_000),
        segments: [{ textStart: 0, textEnd: 3,
          citation: { locator: locator(1, 0, 4_000), chapterPath: "old" } }],
      },
      evidenceIds: [],
    });

    const replacement = state.resolveReadingIntent({
      locator: locator(9, 100, 100),
      endLocator: locator(9, 900, 900),
      direction: "forward",
    });

    expect(replacement).toEqual({
      locator: locator(9, 100, 100),
      endLocator: locator(9, 900, 900),
      direction: "forward",
      resumed: false,
    });
  });

  it("keeps the first root plan as a monotonic baseline across checkpoints", () => {
    const state = RollingReadingState.create({ rootGoal: "read", currentPlan: [], budget: {} });
    state.updatePlan([
      { id: "structure", title: "理解全书结构", status: "in_progress" },
      { id: "evidence", title: "核验关键证据", status: "pending" },
    ]);
    const restored = RollingReadingState.fromCheckpoint(state.toCheckpoint());

    expect(() => restored.updatePlan([
      { id: "structure", title: "偷偷改写目标", status: "pending" },
    ])).toThrow("READING_PLAN_BASELINE_VIOLATION");
    expect(restored.toCheckpoint().currentPlan).toEqual([
      { id: "structure", title: "理解全书结构", status: "in_progress" },
      { id: "evidence", title: "核验关键证据", status: "pending" },
    ]);
  });

  it("normalizes an omitted plan status to pending so it can advance after recovery", () => {
    const state = RollingReadingState.create({ rootGoal: "read", currentPlan: [], budget: {} });
    state.updatePlan([{ id: "evidence", title: "核验关键证据" }]);
    const restored = RollingReadingState.fromCheckpoint(state.toCheckpoint());

    expect(restored.toCheckpoint().currentPlan).toEqual([
      { id: "evidence", title: "核验关键证据", status: "pending" },
    ]);
    expect(() => restored.updatePlan([
      { id: "evidence", title: "核验关键证据", status: "completed" },
    ])).not.toThrow();
  });

  it("blocks no-benefit repeated TOC, search, and read calls", () => {
    const state = RollingReadingState.create({ rootGoal: "read", currentPlan: [], budget: {} });
    state.recordExploration("book_toc", { limit: 100 }, { entries: [{ nodeId: "one" }] });
    state.recordExploration("book_search_text", { query: "核心论证", limit: 10 }, { hits: [] });
    state.recordBookRead({
      output: {
        text: "evidence",
        nextLocator: locator(2, 300, 300),
        segments: [{
          textStart: 0,
          textEnd: 8,
          citation: { locator: locator(2, 100, 300), chapterPath: "chapter" },
        }],
      },
      evidenceIds: ["evidence-1"],
    });
    state.recordExploration("book_read", {
      locator: locator(2, 100, 100), endLocator: locator(2, 300, 300), direction: "forward",
    }, {});

    expect(state.evaluateExploration("book_toc", { limit: 100 })).toMatchObject({
      allowed: false, errorCode: "READING_REPEAT_TOC",
    });
    expect(state.evaluateExploration("book_search_text", { query: "核心论证", limit: 10 })).toMatchObject({
      allowed: false, errorCode: "READING_REPEAT_SEARCH",
    });
    expect(state.evaluateExploration("book_read", {
      locator: locator(2, 100, 100), endLocator: locator(2, 300, 300), direction: "forward",
    })).toMatchObject({ allowed: false, errorCode: "READING_RANGE_ALREADY_COVERED" });
  });

  it("enforces structure then locator discovery before body reading", () => {
    const state = RollingReadingState.create({ rootGoal: "read", currentPlan: [], budget: {} });

    expect(state.evaluateExploration("book_search_text", { query: "核心论证" })).toMatchObject({
      allowed: false, errorCode: "READING_STRUCTURE_REQUIRED",
    });
    state.recordExploration("book_toc", {}, { entries: [{ nodeId: "one" }] });
    expect(state.evaluateExploration("book_read", {
      locator: locator(2, 100, 100), direction: "forward",
    })).toMatchObject({ allowed: false, errorCode: "READING_LOCATOR_REQUIRED" });
    state.recordExploration("book_search_text", { query: "核心论证" }, {
      hits: [{ citation: { locator: locator(2, 100, 120) } }],
    });
    expect(state.evaluateExploration("book_read", {
      locator: locator(2, 100, 100), direction: "forward",
    })).toEqual({ allowed: true });
    expect(RollingReadingState.fromCheckpoint(state.toCheckpoint()).explorationPhase()).toBe("read");
  });

  it("tracks exhausted flat TOC and completed tree across legacy-compatible checkpoints", () => {
    const state = RollingReadingState.create({ rootGoal: "read", currentPlan: [], budget: {} });
    state.recordExploration("book_toc", {}, {
      entries: [{ nodeId: "one" }], hasMore: true, nextCursor: "page-2",
    });
    expect(state.toCheckpoint().exploration).toMatchObject({
      flatTocHasMore: true,
      flatTocNextCursor: "page-2",
      treeSeen: false,
    });

    state.recordExploration("book_toc", { cursor: "page-2" }, {
      entries: [{ nodeId: "two" }], hasMore: false, nextCursor: null,
    });
    state.recordExploration("book_toc_tree", {}, { entries: [{ nodeId: "one", children: [] }] });
    expect(RollingReadingState.fromCheckpoint(state.toCheckpoint()).toCheckpoint().exploration).toMatchObject({
      flatTocHasMore: false,
      flatTocNextCursor: null,
      treeSeen: true,
    });
  });

  it("migrates legacy plan descriptions but only exposes title afterwards", () => {
    const checkpoint = RollingReadingState.create({
      rootGoal: "read",
      currentPlan: [{ id: "legacy", description: "旧计划标题", status: "in_progress" }],
      budget: {},
    }).toCheckpoint();

    expect(RollingReadingState.fromCheckpoint(checkpoint).toCheckpoint().currentPlan).toEqual([
      { id: "legacy", title: "旧计划标题", status: "in_progress" },
    ]);
  });
});

function locator(sectionIndex: number, start: number, end: number) {
  return {
    version: 1 as const,
    position: { kind: "epub_text" as const, sectionIndex, start, end },
  };
}

describe("TOC batch coverage", () => {
  const page = (processedUnits: number, text: string, pending: boolean, unavailable = 0) => ({
    text, segments: [],
    units: [{ unitIndex: processedUnits - 1, nodeId: "chapter", kind: "subtree" }],
    unavailable: [],
    continuation: { next: pending ? { cursor: "next" } : null },
    coverage: { selectionId: "selection", processedUnits, totalUnits: 2,
      totalChars: 6, returnedChars: 6, pendingChars: 0, unavailableUnits: unavailable,
      unavailableChars: unavailable ? 50_001 : 0, complete: !pending && !unavailable },
  });
  const create = () => RollingReadingState.create({ rootGoal: "Read chapter", currentPlan: [], budget: {} });
  it("counts successful batches and retains pending TOC reads across checkpoints", () => {
    let state = create();
    state.recordBookRead({ output: page(1, "abc", true), evidenceIds: [] });
    expect(state.toCheckpoint().continuationPending).toBe(true);
    expect(state.toCheckpoint().tocRead).toMatchObject({ readChars: 3, complete: false });
    state = RollingReadingState.fromCheckpoint(state.toCheckpoint());
    state.recordBookRead({ output: page(2, "def", false), evidenceIds: [] });
    expect(state.toCheckpoint().tocRead).toMatchObject({ readChars: 6, complete: true });
  });
  it("does not trust a final cursor result as proof of previous reads", () => {
    const state = create();
    state.recordBookRead({ output: page(2, "def", false), evidenceIds: [] });
    expect(state.toCheckpoint().tocRead).toMatchObject({ readChars: 3, complete: false, contiguousFromStart: false });
  });
  it("keeps unavailable ranges incomplete after all readable batches finish", () => {
    const state = create();
    state.recordBookRead({ output: page(1, "abc", true, 1), evidenceIds: [] });
    state.recordBookRead({ output: page(2, "def", false, 1), evidenceIds: [] });
    expect(state.toCheckpoint().tocRead).toMatchObject({ pending: false, complete: false, unavailableUnits: 1 });
  });
});
