import type {
  LanguageModelPort as SupportLanguageModelPort,
  ModelCapabilityCatalog,
  ModelConfigPort as SupportModelConfigPort,
  TokenEstimatorCatalog,
} from "../../../support/ai-model/public";
import type {
  LanguageModelPort,
  ModelCompletionRequest,
} from "../application/ports/language-model.port";
import type { ModelConfigPort } from "../application/ports/model-config.port";
import type { ModelRuntimePort } from "../application/ports/model-runtime.port";

export class AiModelSupportAdapter implements
  LanguageModelPort,
  ModelConfigPort,
  ModelRuntimePort {
  readonly streamText?: LanguageModelPort["streamText"];

  constructor(
    private readonly model: SupportLanguageModelPort,
    private readonly configs: SupportModelConfigPort,
    private readonly capabilities: ModelCapabilityCatalog,
    private readonly estimators: TokenEstimatorCatalog,
  ) {
    if (model.streamText) {
      this.streamText = (request, onDelta) => model.streamText!(request, onDelta);
    }
  }

  complete(request: ModelCompletionRequest) {
    return this.model.complete(request);
  }

  getCredential(userId: number) {
    return this.configs.getCredential(userId);
  }

  assertCapability(
    providerId: string,
    modelId: string,
    capability: "tools" | "strictTools" | "streaming",
  ): void {
    this.capabilities.assertCapability(providerId, modelId, capability);
  }

  context(providerId: string, modelId: string) {
    const profile = this.capabilities.resolve(providerId, modelId);
    return {
      contextWindowTokens: profile.capabilities.contextWindowTokens,
      maxOutputTokens: profile.capabilities.maxOutputTokens,
      tokenizer: this.estimators.require(profile.capabilities.tokenizerId),
    };
  }
}
