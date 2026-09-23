import { ModelProfileRegistry, type ModelProfileContribution } from "./model-profile";

describe("ModelProfileRegistry", () => {
  it("resolves provider-owned contributions and fails closed for unknown providers", () => {
    const contribution: ModelProfileContribution = {
      providerId: "fixture",
      resolve: (modelId) => ({
        providerId: "fixture",
        modelId,
        capabilities: {
          tools: true,
          strictTools: true,
          streaming: true,
          reasoning: false,
          reasoningWithTools: false,
          contextWindowTokens: 32_000,
          maxOutputTokens: 4_000,
          tokenizerId: "fixture-tokenizer",
          cachePolicyId: "none",
        },
      }),
    };
    const profiles = new ModelProfileRegistry([contribution]);

    expect(profiles.assertCapability("fixture", "fixture-chat", "strictTools")
      .capabilities).toMatchObject({
        strictTools: true,
        contextWindowTokens: 32_000,
        maxOutputTokens: 4_000,
      });
    expect(() => profiles.resolve("unknown", "unknown-chat"))
      .toThrow(expect.objectContaining({ kind: "capability_unsupported" }));
  });
});
