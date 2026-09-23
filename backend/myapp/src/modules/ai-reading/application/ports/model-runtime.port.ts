export const AI_READING_MODEL_RUNTIME_PORT = Symbol("AI_READING_MODEL_RUNTIME_PORT");

export interface ModelTokenEstimator {
  encode(value: string): number[];
  count(value: string): number;
}

export interface ModelRuntimeContext {
  contextWindowTokens: number;
  maxOutputTokens: number;
  tokenizer: ModelTokenEstimator;
}

export interface ModelRuntimePort {
  assertCapability(
    providerId: string,
    modelId: string,
    capability: "tools" | "strictTools" | "streaming",
  ): void;
  context(providerId: string, modelId: string): ModelRuntimeContext;
}
