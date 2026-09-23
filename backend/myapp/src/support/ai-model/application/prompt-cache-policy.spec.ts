import type { ModelMessage, ModelToolDefinition } from "./ports/language-model.port";
import {
  AutomaticPrefixPromptCachePolicy,
  PromptCachePolicyRegistry,
  type PromptPlan,
} from "./prompt-cache-policy";

describe("Prompt cache policy", () => {
  const stablePrefix: ModelMessage[] = [
    { role: "system", content: "stable rules" },
    { role: "user", content: "frozen root goal and profile" },
  ];
  const tools: ModelToolDefinition[] = [{
    type: "function",
    function: { name: "book_read", description: "read", parameters: { type: "object" }, strict: true },
  }];

  it("projects stable prefix, append-only history and one replaceable dynamic tail", () => {
    const plan: PromptPlan = {
      stablePrefix,
      appendOnlyHistory: [
        { role: "assistant", content: null, toolCalls: [{ id: "c1", name: "book_read", arguments: "{}" }] },
        { role: "tool", toolCallId: "c1", content: "page one" },
      ],
      dynamicTail: [{ role: "user", content: "budget=9; usage=1; childResults=[]" }],
      tools,
      toolStage: "reading",
    };
    const projected = new AutomaticPrefixPromptCachePolicy().project(plan);

    expect(projected.messages).toEqual([
      ...stablePrefix,
      ...plan.appendOnlyHistory,
      ...plan.dynamicTail,
    ]);
    expect(projected.stablePrefixFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(projected.toolSchemaFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(projected.cacheBoundaryReason).toBe("initial_request");
    expect(projected.providerOptions).toBeUndefined();
  });

  it("measures token-level LCP and records a Tool-stage cache boundary", () => {
    const tokenizer = { encode: (value: string) => Array.from(value, (character) => character.codePointAt(0)!) };
    const policy = new AutomaticPrefixPromptCachePolicy();
    const first = policy.project({
      stablePrefix,
      appendOnlyHistory: [],
      dynamicTail: [{ role: "user", content: "budget=10" }],
      tools,
      toolStage: "navigation",
    }, { tokenizer });
    const second = policy.project({
      stablePrefix,
      appendOnlyHistory: [],
      dynamicTail: [{ role: "user", content: "budget=9" }],
      tools: [],
      toolStage: "finalization",
    }, { tokenizer, previous: first });

    expect(second.longestCommonPrefixTokens).toBeGreaterThan(0);
    expect(second.longestCommonPrefixTokens).toBeLessThan(second.estimatedInputTokens!);
    expect(second.cacheBoundaryReason).toBe("tool_stage_changed");
  });

  it("keeps the frozen prefix in the LCP when history grows and dynamic state is replaced", () => {
    const tokenizer = { encode: (value: string) => Array.from(value, (character) => character.codePointAt(0)!) };
    const policy = new AutomaticPrefixPromptCachePolicy();
    const first = policy.project({
      stablePrefix,
      appendOnlyHistory: [],
      dynamicTail: [{ role: "user", content: "budget=10; childResults=[]" }],
      tools,
      toolStage: "reading",
    }, { tokenizer });
    const second = policy.project({
      stablePrefix,
      appendOnlyHistory: [
        { role: "assistant", content: null, toolCalls: [{ id: "c1", name: "book_read", arguments: "{}" }] },
        { role: "tool", toolCallId: "c1", content: "page one" },
      ],
      dynamicTail: [{ role: "user", content: "budget=9; childResults=[c1]" }],
      tools,
      toolStage: "reading",
    }, { tokenizer, previous: first });

    expect(second.cacheBoundaryReason).toBe("prefix_continued");
    expect(second.longestCommonPrefixTokens).toBeGreaterThan(JSON.stringify(stablePrefix).length);
  });

  it("registers none, automatic-prefix and explicit-segments capabilities but only executes configured policies", () => {
    const registry = new PromptCachePolicyRegistry([new AutomaticPrefixPromptCachePolicy()]);
    expect(registry.require("automatic-prefix").id).toBe("automatic-prefix");
    expect(() => registry.require("explicit-segments")).toThrow();
  });
});
