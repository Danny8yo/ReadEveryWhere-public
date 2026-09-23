import type { ModelProfile } from "./model-profile";

export const MODEL_USE_OUTPUT_LIMITS = Object.freeze({
  selectionQa: 8_192,
  toolLoop: 16_384,
  finalAnswer: 16_384,
  bookClassification: 16_384,
  connectionTest: 4_096,
  metadataExtraction: 8_192,
});

export function outputLimitFor(
  use: keyof typeof MODEL_USE_OUTPUT_LIMITS,
  profile: ModelProfile,
): number {
  return Math.min(MODEL_USE_OUTPUT_LIMITS[use], profile.capabilities.maxOutputTokens);
}
