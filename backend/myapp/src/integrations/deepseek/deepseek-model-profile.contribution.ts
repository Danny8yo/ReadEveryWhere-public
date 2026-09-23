import type {
  ModelProfile,
  ModelProfileContribution,
} from "../../support/ai-model/public";
import { isDeepSeekReasoningModel } from "./deepseek-model-policy";
import { DEEPSEEK_V3_TOKENIZER_ID } from "./deepseek-token-estimator";

export const DEEPSEEK_DEFAULT_MODEL_CONFIG = Object.freeze({
  provider: "deepseek",
  displayName: "DeepSeek-V4-flash",
  modelId: "deepseek-v4-flash",
});

export class DeepSeekModelProfileContribution implements ModelProfileContribution {
  readonly providerId = "deepseek";

  resolve(modelId: string): ModelProfile {
    const reasoning = isDeepSeekReasoningModel(modelId);
    return {
      providerId: this.providerId,
      modelId,
      capabilities: {
        tools: !reasoning,
        strictTools: !reasoning,
        streaming: true,
        reasoning,
        reasoningWithTools: false,
        contextWindowTokens: 1_000_000,
        maxOutputTokens: 384_000,
        tokenizerId: DEEPSEEK_V3_TOKENIZER_ID,
        cachePolicyId: "automatic-prefix",
      },
    };
  }
}
