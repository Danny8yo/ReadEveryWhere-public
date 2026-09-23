import { ProviderRegistry } from "./provider-registry";
import type { ModelProvider } from "./ports/model-provider.port";

describe("ProviderRegistry", () => {
  const deepseek = { providerId: "deepseek" } as ModelProvider;

  it("routes a registered provider and rejects unknown providers fail-closed", () => {
    const registry = new ProviderRegistry([deepseek]);

    expect(registry.require("deepseek")).toBe(deepseek);
    expect(() => registry.require("unknown")).toThrow(expect.objectContaining({
      kind: "capability_unsupported",
      providerId: "unknown",
    }));
  });
});
