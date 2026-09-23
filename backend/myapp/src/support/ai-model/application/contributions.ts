import type { DefaultModelConfig } from "./ports/model-config.port";
import type { ModelProvider } from "./ports/model-provider.port";
import type { TokenEstimator } from "./ports/token-estimator.port";
import type { ModelProfileContribution } from "./model-profile";

export const MODEL_PROVIDER_CONTRIBUTIONS = Symbol("MODEL_PROVIDER_CONTRIBUTIONS");
export const MODEL_PROFILE_CONTRIBUTIONS = Symbol("MODEL_PROFILE_CONTRIBUTIONS");
export const TOKEN_ESTIMATOR_CONTRIBUTIONS = Symbol("TOKEN_ESTIMATOR_CONTRIBUTIONS");
export const DEFAULT_MODEL_CONFIG = Symbol("DEFAULT_MODEL_CONFIG");
export const AI_DEBUG_LOG_PORT = Symbol("AI_DEBUG_LOG_PORT");

export type ModelProviderContributions = readonly ModelProvider[];
export type ModelProfileContributions = readonly ModelProfileContribution[];
export type TokenEstimatorContributions = readonly TokenEstimator[];
export type DefaultModelConfigContribution = Readonly<DefaultModelConfig>;
