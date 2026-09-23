import { LanguageModelError } from "./ports/language-model.port";
import type { ModelProvider } from "./ports/model-provider.port";

export class ProviderRegistry {
  private readonly providers: Map<string, ModelProvider>;

  constructor(providers: readonly ModelProvider[]) {
    this.providers = new Map(providers.map((provider) => [provider.providerId, provider]));
    if (this.providers.size !== providers.length) throw new Error("DUPLICATE_MODEL_PROVIDER");
  }

  require(providerId: string): ModelProvider {
    const provider = this.providers.get(providerId);
    if (provider) return provider;
    throw new LanguageModelError(
      "MODEL_PROVIDER_UNSUPPORTED",
      `Model provider is not registered: ${providerId}`,
      false,
      null,
      0,
      "capability_unsupported",
      providerId,
      null,
    );
  }
}
