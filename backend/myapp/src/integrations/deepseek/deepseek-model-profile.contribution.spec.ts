import { ModelProfileRegistry } from "../../support/ai-model/application/model-profile";
import { DeepSeekModelProfileContribution } from "./deepseek-model-profile.contribution";

describe("DeepSeekModelProfileContribution", () => {
  it("declares Tool capabilities for chat models and rejects reasoning models", () => {
    const profiles = new ModelProfileRegistry([new DeepSeekModelProfileContribution()]);

    expect(profiles.assertCapability("deepseek", "deepseek-v4-flash", "strictTools")
      .capabilities).toMatchObject({
        strictTools: true,
        contextWindowTokens: 1_000_000,
        maxOutputTokens: 384_000,
      });
    expect(() => profiles.assertCapability("deepseek", "deepseek-reasoner", "strictTools"))
      .toThrow(expect.objectContaining({ kind: "capability_unsupported" }));
  });
});
