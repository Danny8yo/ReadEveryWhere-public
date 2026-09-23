import { LanguageModelError } from "./ports/language-model.port";

export type PromptCachePolicyId = "none" | "automatic-prefix" | "explicit-segments";

export interface ModelCapabilities {
  tools: boolean;
  strictTools: boolean;
  streaming: boolean;
  reasoning: boolean;
  reasoningWithTools: boolean;
  contextWindowTokens: number;
  maxOutputTokens: number;
  tokenizerId: string;
  cachePolicyId: PromptCachePolicyId;
}

export interface ModelProfile {
  providerId: string;
  modelId: string;
  capabilities: ModelCapabilities;
}

export interface ModelProfileContribution {
  readonly providerId: string;
  resolve(modelId: string): ModelProfile | null;
}

export interface ModelCapabilityCatalog {
  resolve(providerId: string, modelId: string): ModelProfile;
  assertCapability(
    providerId: string,
    modelId: string,
    capability: "tools" | "strictTools" | "streaming",
  ): ModelProfile;
}

export class ModelProfileRegistry implements ModelCapabilityCatalog {
  private readonly contributions: Map<string, ModelProfileContribution>;

  constructor(contributions: readonly ModelProfileContribution[] = []) {
    this.contributions = new Map(
      contributions.map((contribution) => [contribution.providerId, contribution]),
    );
    if (this.contributions.size !== contributions.length) {
      throw new Error("DUPLICATE_MODEL_PROFILE_CONTRIBUTION");
    }
  }

  resolve(providerId: string, modelId: string): ModelProfile {
    const profile = this.contributions.get(providerId)?.resolve(modelId) ?? null;
    return profile ?? this.unsupported(providerId, modelId);
  }

  assertCapability(
    providerId: string,
    modelId: string,
    capability: "tools" | "strictTools" | "streaming",
  ): ModelProfile {
    const profile = this.resolve(providerId, modelId);
    if (profile.capabilities[capability]) return profile;
    throw new LanguageModelError(
      "MODEL_CAPABILITY_UNSUPPORTED",
      `The configured model does not support ${capability}`,
      false,
      null,
      0,
      "capability_unsupported",
      providerId,
      null,
    );
  }

  private unsupported(providerId: string, modelId: string): never {
    throw new LanguageModelError(
      "MODEL_PROFILE_NOT_FOUND",
      `No model profile is registered for ${providerId}/${modelId}`,
      false,
      null,
      0,
      "capability_unsupported",
      providerId,
      null,
    );
  }
}
