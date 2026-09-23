import type { ModelMessage } from "./ports/language-model.port";
import type { PromptPlan } from "./ports/language-model.port";
import { AgentContextWindow } from "./context-window";

describe("AgentContextWindow", () => {
  const base: ModelMessage[] = [
    { role: "system", content: "stable rules" },
    { role: "user", content: "root goal" },
  ];

  it("uses the tokenizer selected by the model profile on instance paths", () => {
    const count = jest.fn((value: string) => Array.from(value).length);
    const context = new AgentContextWindow({
      assertCapability: jest.fn(),
      context: () => ({
        contextWindowTokens: 128_000,
        maxOutputTokens: 16_384,
        tokenizer: {
          encode: (value) => Array.from(value, (character) => character.codePointAt(0)!),
          count,
        },
      }),
    });

    context.usage(base, [], "deepseek", "deepseek-v4-flash");

    expect(count).toHaveBeenCalledWith("stable rules");
    expect(count).toHaveBeenCalledWith("root goal");
  });

  it("fails closed when production instance dependencies are unavailable", () => {
    expect(() => new AgentContextWindow().usage(
      base,
      [],
      "deepseek",
      "deepseek-v4-flash",
    )).toThrow("MODEL_CONTEXT_DEPENDENCIES_UNAVAILABLE");
  });

  it("compacts PromptPlan history without changing stable prefix or dynamic tail", () => {
    const plan: PromptPlan = {
      stablePrefix: base,
      appendOnlyHistory: [
        { role: "assistant", content: "old action" },
        { role: "tool", toolCallId: "old-call", content: "old observation" },
        {
          role: "assistant",
          content: null,
          toolCalls: [{ id: "latest-call", name: "book_read", arguments: "{}" }],
        },
        { role: "tool", toolCallId: "latest-call", content: "latest observation" },
      ],
      dynamicTail: [{ role: "user", content: "budget=9; usage=1" }],
      tools: [],
      toolStage: "reading",
    };

    const compacted = AgentContextWindow.compactPromptPlan(plan, { currentPlan: ["continue"] });

    expect(compacted.stablePrefix).toEqual(plan.stablePrefix);
    expect(compacted.dynamicTail).toEqual(plan.dynamicTail);
    expect(compacted.appendOnlyHistory.some((message) => message.toolCallId === "latest-call")).toBe(true);
    expect(JSON.stringify(compacted.appendOnlyHistory)).not.toContain("old observation");
  });

  it("compacts after four tool observation batches and preserves stable/recent context", () => {
    const messages = [
      ...base,
      { role: "assistant" as const, content: "old action" },
      { role: "tool" as const, content: "old observation", toolCallId: "old-call" },
      { role: "assistant" as const, content: "recent action" },
      { role: "tool" as const, content: "recent observation", toolCallId: "recent-call" },
    ];

    expect(AgentContextWindow.shouldCompact(messages, 4)).toBe(true);
    const compacted = AgentContextWindow.compact(messages, {
      plan: ["continue"],
      reasoning_content: "must be removed",
    });

    expect(compacted[0].content).toBe("stable rules");
    expect(compacted[1].content).toBe("root goal");
    expect(compacted.some((message) => message.content?.includes("recent observation"))).toBe(true);
    expect(JSON.stringify(compacted)).not.toContain("must be removed");
    expect(JSON.stringify(compacted)).not.toContain("old observation");
  });

  it("compacts when the estimated request exceeds the token-aware input budget", () => {
    expect(AgentContextWindow.shouldCompact([
      ...base,
      { role: "tool", content: "界".repeat(112_001), toolCallId: "large-observation" },
    ], 1)).toBe(true);
  });

  it("counts tool call names and arguments toward the token-aware trigger", () => {
    expect(AgentContextWindow.shouldCompact([
      ...base,
      {
        role: "assistant",
        content: null,
        toolCalls: [{
          id: "large-call",
          name: "book_search_text",
          arguments: JSON.stringify({ query: "界".repeat(112_000) }),
        }],
      },
    ], 0)).toBe(true);
  });

  it("preserves the complete latest assistant turn when it contains multiple tool calls", () => {
    const messages: ModelMessage[] = [
      ...base,
      { role: "assistant", content: "old action" },
      { role: "tool", content: "old observation", toolCallId: "old" },
      {
        role: "assistant",
        content: null,
        toolCalls: [
          { id: "read-1", name: "book_read", arguments: "{}" },
          { id: "read-2", name: "book_read", arguments: "{}" },
          { id: "toc-1", name: "book_toc", arguments: "{}" },
        ],
      },
      { role: "tool", content: "first observation", toolCallId: "read-1" },
      { role: "tool", content: "second observation", toolCallId: "read-2" },
      { role: "tool", content: "toc observation", toolCallId: "toc-1" },
    ];

    const compacted = AgentContextWindow.compact(messages, { plan: ["continue"] });
    const recentAssistant = compacted.find((message) => message.toolCalls?.length === 3);

    expect(recentAssistant?.toolCalls?.map((call) => call.id)).toEqual(["read-1", "read-2", "toc-1"]);
    expect(compacted.filter((message) => message.role === "tool").map((message) => message.toolCallId))
      .toEqual(["read-1", "read-2", "toc-1"]);
    expect(JSON.stringify(compacted)).not.toContain("old observation");
  });

  it("excludes ledger-only evidence bodies from the bounded model checkpoint", () => {
    const evidence = Array.from({ length: 100 }, (_, index) => ({
      evidenceId: `evidence-${index}`,
      quote: `quote-${index}-${"x".repeat(4_000)}`,
      chapterPath: `chapter-${index}`,
    }));

    const compacted = AgentContextWindow.compact(base, {
      rootGoal: "understand the book",
      evidence,
      instruction: "continue from verified evidence",
    });
    const usage = AgentContextWindow.usage(compacted);
    const checkpointContent = compacted[2].content ?? "";
    const checkpoint = JSON.parse(checkpointContent.replace(/^Structured checkpoint: /, ""));

    expect(usage.totalTokens).toBeLessThanOrEqual(32_000);
    expect(checkpoint).toMatchObject({
      rootGoal: "understand the book",
      retainedEvidenceIds: [],
    });
    expect(checkpoint).not.toHaveProperty("evidence");
    expect(checkpointContent).not.toContain("quote-99");
  });

  it("preserves oversized arguments in the latest complete Tool Call and Result pair", () => {
    const messages: ModelMessage[] = [
      ...base,
      {
        role: "assistant",
        content: null,
        toolCalls: [{
          id: "large-call",
          name: "book_search_text",
          arguments: JSON.stringify({ query: "x".repeat(30_000) }),
        }],
      },
      { role: "tool", toolCallId: "large-call", content: "observation" },
    ];

    const compacted = AgentContextWindow.compact(messages, { plan: ["continue"] });
    const retainedCall = compacted.flatMap((message) => message.toolCalls ?? [])[0];

    expect(JSON.parse(retainedCall.arguments)).toMatchObject({ query: "x".repeat(30_000) });
    expect(compacted.find((message) => message.toolCallId === "large-call")?.content).toBe("observation");
  });

  it("keeps one 50000-character book_read result intact within the 128k context budget", () => {
    const text = "正文".repeat(25_000);
    const messages: ModelMessage[] = [
      { role: "system", content: "s".repeat(8_000) },
      { role: "user", content: "g".repeat(2_000) },
      {
        role: "assistant",
        content: null,
        toolCalls: [{ id: "read-latest", name: "book_read", arguments: "{}" }],
      },
      {
        role: "tool",
        toolCallId: "read-latest",
        content: JSON.stringify({ text, evidence: [{ evidenceId: "evidence-latest" }] }),
      },
    ];

    const compacted = AgentContextWindow.compact(messages, {
      rootGoal: "read the chapter",
      evidenceIds: ["evidence-latest"],
    });
    const latest = compacted.find((message) => message.toolCallId === "read-latest");

    expect(latest?.content).toContain(text);
    expect(latest?.content).not.toContain('"truncated":true');
    expect(AgentContextWindow.shouldCompact(messages, 1)).toBe(false);
    expect(AgentContextWindow.usage(messages).totalTokens).toBeLessThanOrEqual(128_000);
  });

  it("keeps every explicitly retained evidence ID while enforcing the checkpoint hard limit", () => {
    const retainedEvidenceIds = Array.from({ length: 48 }, (_, index) => `retained-${index}`);
    const ledgerOnlyEvidenceIds = Array.from({ length: 500 }, (_, index) => `ledger-only-${index}`);
    const compacted = AgentContextWindow.compact(base, {
      rootGoal: "read the whole target",
      currentContinuation: {
        next: { version: 1, position: { kind: "epub_text", sectionIndex: 7, start: 8_000, end: 8_000 } },
      },
      coverage: {
        totalCharacters: 50_000,
        latestRange: { sectionIndex: 7, start: 8_000, end: 12_000 },
      },
      findings: retainedEvidenceIds.slice(0, 10).map((evidenceId) => ({
        statement: `finding-${evidenceId}-${"x".repeat(500)}`,
        evidenceIds: [evidenceId],
      })),
      retainedEvidenceIds,
      ledgerOnlyEvidenceIds,
    });
    const checkpointContent = compacted.find((message) =>
      message.content?.startsWith("Structured checkpoint: "))?.content ?? "";

    expect(checkpointContent.length).toBeLessThanOrEqual(20_100);
    for (const evidenceId of retainedEvidenceIds) expect(checkpointContent).toContain(`\"${evidenceId}\"`);
    expect(checkpointContent).not.toContain("ledger-only-499");
    expect(checkpointContent).toContain('"sectionIndex":7');
    expect(checkpointContent).toContain('"start":8000');
  });

  it("promotes bounded child-summary evidence IDs before checkpoint arrays can shrink", () => {
    const compacted = AgentContextWindow.compact(base, {
      rootGoal: "merge child reading results",
      retainedEvidenceIds: ["root-evidence"],
      childSummaries: Array.from({ length: 6 }, (_, index) => ({
        agentRunId: `child-${index}`,
        goal: `child goal ${index}`,
        status: "completed",
        summary: `summary-${index}-${"x".repeat(2_000)}`,
        evidenceIds: [`child-evidence-${index}`],
        openQuestions: Array.from({ length: 20 }, (__, questionIndex) => (
          `question-${index}-${questionIndex}-${"y".repeat(400)}`
        )),
      })),
    });
    const checkpointContent = compacted.find((message) => (
      message.content?.startsWith("Structured checkpoint: ")
    ))?.content ?? "";
    const checkpoint = JSON.parse(checkpointContent.replace(/^Structured checkpoint: /, ""));

    expect(checkpointContent.length).toBeLessThanOrEqual(20_100);
    expect(checkpoint.retainedEvidenceIds).toEqual([
      "root-evidence",
      ...Array.from({ length: 6 }, (_, index) => `child-evidence-${index}`),
    ]);
  });
});
