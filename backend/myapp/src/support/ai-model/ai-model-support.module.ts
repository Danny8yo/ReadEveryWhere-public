import { Global, Module } from "@nestjs/common";
import { CryptoModule } from "../../platform/crypto/crypto.module";
import { CryptoService } from "../../platform/crypto/crypto.service";
import { SqlitePersistenceModule } from "../../platform/persistence/sqlite/sqlite-persistence.module";
import { SqliteService } from "../../platform/persistence/sqlite/sqlite.service";
import { AiModelLoggingModule } from "./ai-model-logging.module";
import {
  AI_DEBUG_LOG_PORT,
  DEFAULT_MODEL_CONFIG,
  MODEL_PROFILE_CONTRIBUTIONS,
  MODEL_PROVIDER_CONTRIBUTIONS,
  TOKEN_ESTIMATOR_CONTRIBUTIONS,
  type DefaultModelConfigContribution,
  type ModelProfileContributions,
  type ModelProviderContributions,
  type TokenEstimatorContributions,
} from "./application/contributions";
import {
  LANGUAGE_MODEL_GATEWAY,
  MODEL_CONFIG_PORT,
  MODEL_PROFILE_REGISTRY,
  TOKEN_ESTIMATOR_REGISTRY,
  LanguageModelGateway,
} from "./application/language-model.gateway";
import { ModelConfigService } from "./application/model-config.service";
import { ModelProfileRegistry } from "./application/model-profile";
import type { AiDebugLogPort } from "./application/ports/ai-debug-log.port";
import {
  AutomaticPrefixPromptCachePolicy,
  PromptCachePolicyRegistry,
} from "./application/prompt-cache-policy";
import { ProviderRegistry } from "./application/provider-registry";
import { TokenEstimatorRegistry } from "./application/ports/token-estimator.port";
import { ModelConfigRepository } from "./infrastructure/model-config.repository";
import { ModelConfigController } from "./presentation/http/model-config.controller";

@Global()
@Module({
  imports: [SqlitePersistenceModule, CryptoModule, AiModelLoggingModule],
  controllers: [ModelConfigController],
  providers: [
    {
      provide: ModelConfigRepository,
      inject: [SqliteService, CryptoService, DEFAULT_MODEL_CONFIG, MODEL_PROVIDER_CONTRIBUTIONS],
      useFactory: (
        sqlite: SqliteService,
        crypto: CryptoService,
        defaults: DefaultModelConfigContribution,
        providers: ModelProviderContributions,
      ) => new ModelConfigRepository(
        sqlite,
        crypto,
        defaults,
        new Set(providers.map((provider) => provider.providerId)),
      ),
    },
    { provide: MODEL_CONFIG_PORT, useExisting: ModelConfigRepository },
    {
      provide: ProviderRegistry,
      inject: [MODEL_PROVIDER_CONTRIBUTIONS],
      useFactory: (providers: ModelProviderContributions) => new ProviderRegistry(providers),
    },
    {
      provide: ModelProfileRegistry,
      inject: [MODEL_PROFILE_CONTRIBUTIONS],
      useFactory: (profiles: ModelProfileContributions) => new ModelProfileRegistry(profiles),
    },
    { provide: MODEL_PROFILE_REGISTRY, useExisting: ModelProfileRegistry },
    {
      provide: TOKEN_ESTIMATOR_REGISTRY,
      inject: [TOKEN_ESTIMATOR_CONTRIBUTIONS],
      useFactory: (estimators: TokenEstimatorContributions) => new TokenEstimatorRegistry(estimators),
    },
    {
      provide: PromptCachePolicyRegistry,
      useFactory: () => new PromptCachePolicyRegistry([new AutomaticPrefixPromptCachePolicy()]),
    },
    {
      provide: LanguageModelGateway,
      inject: [
        ProviderRegistry,
        MODEL_PROFILE_REGISTRY,
        PromptCachePolicyRegistry,
        TOKEN_ESTIMATOR_REGISTRY,
        AI_DEBUG_LOG_PORT,
      ],
      useFactory: (
        providers: ProviderRegistry,
        profiles: ModelProfileRegistry,
        cachePolicies: PromptCachePolicyRegistry,
        tokenEstimators: TokenEstimatorRegistry,
        debugLog: AiDebugLogPort,
      ) => new LanguageModelGateway(
        providers,
        profiles,
        cachePolicies,
        tokenEstimators,
        debugLog,
      ),
    },
    { provide: LANGUAGE_MODEL_GATEWAY, useExisting: LanguageModelGateway },
    {
      provide: ModelConfigService,
      inject: [MODEL_CONFIG_PORT, LANGUAGE_MODEL_GATEWAY, MODEL_PROFILE_REGISTRY, DEFAULT_MODEL_CONFIG],
      useFactory: (
        modelConfigs: ModelConfigRepository,
        languageModel: LanguageModelGateway,
        profiles: ModelProfileRegistry,
        defaults: DefaultModelConfigContribution,
      ) => new ModelConfigService(modelConfigs, languageModel, profiles, defaults),
    },
  ],
  exports: [
    LANGUAGE_MODEL_GATEWAY,
    MODEL_CONFIG_PORT,
    MODEL_PROFILE_REGISTRY,
    TOKEN_ESTIMATOR_REGISTRY,
  ],
})
export class AiModelSupportModule {}
