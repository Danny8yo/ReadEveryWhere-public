import { Global, Module } from "@nestjs/common";
import {
  AI_DEBUG_LOG_PORT,
  AiModelLoggingModule,
  DEFAULT_MODEL_CONFIG,
  MODEL_PROFILE_CONTRIBUTIONS,
  MODEL_PROVIDER_CONTRIBUTIONS,
  TOKEN_ESTIMATOR_CONTRIBUTIONS,
  type AiDebugLogPort,
} from "../../support/ai-model/public";
import { DeepSeekLanguageModelAdapter } from "./deepseek-language-model.adapter";
import {
  DEEPSEEK_DEFAULT_MODEL_CONFIG,
  DeepSeekModelProfileContribution,
} from "./deepseek-model-profile.contribution";
import { DeepSeekTokenEstimator } from "./deepseek-token-estimator";

@Global()
@Module({
  imports: [AiModelLoggingModule],
  providers: [
    DeepSeekTokenEstimator,
    DeepSeekModelProfileContribution,
    {
      provide: DeepSeekLanguageModelAdapter,
      inject: [AI_DEBUG_LOG_PORT],
      useFactory: (debugLog: AiDebugLogPort) => new DeepSeekLanguageModelAdapter(
        fetch,
        (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
        Date.now,
        debugLog,
      ),
    },
    {
      provide: MODEL_PROVIDER_CONTRIBUTIONS,
      inject: [DeepSeekLanguageModelAdapter],
      useFactory: (provider: DeepSeekLanguageModelAdapter) => [provider],
    },
    {
      provide: TOKEN_ESTIMATOR_CONTRIBUTIONS,
      inject: [DeepSeekTokenEstimator],
      useFactory: (estimator: DeepSeekTokenEstimator) => [estimator],
    },
    {
      provide: MODEL_PROFILE_CONTRIBUTIONS,
      inject: [DeepSeekModelProfileContribution],
      useFactory: (profile: DeepSeekModelProfileContribution) => [profile],
    },
    { provide: DEFAULT_MODEL_CONFIG, useValue: DEEPSEEK_DEFAULT_MODEL_CONFIG },
  ],
  exports: [
    MODEL_PROVIDER_CONTRIBUTIONS,
    TOKEN_ESTIMATOR_CONTRIBUTIONS,
    MODEL_PROFILE_CONTRIBUTIONS,
    DEFAULT_MODEL_CONFIG,
  ],
})
export class DeepSeekIntegrationModule {}
