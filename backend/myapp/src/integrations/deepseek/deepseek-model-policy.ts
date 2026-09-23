const REASONING_MODEL_PATTERN = /(?:reasoner|(?:^|[-_/])r1(?:[-_/]|$))/iu;

export const DEEPSEEK_TOOL_MAX_OUTPUT_TOKENS = 16_384;
export const DEEPSEEK_FINAL_ANSWER_MAX_OUTPUT_TOKENS = 16_384;
export const DEEPSEEK_CLASSIFIER_MAX_OUTPUT_TOKENS = 16_384;
export const DEEPSEEK_CONNECTION_TEST_MAX_OUTPUT_TOKENS = 4_096;

export function isDeepSeekReasoningModel(modelId: string): boolean {
  return REASONING_MODEL_PATTERN.test(modelId.trim());
}
