import { assertModelNotCancelled, LanguageModelError } from "./ports/language-model.port";
import type {
  LanguageModelPort,
  ModelCompletion,
  ModelCompletionRequest,
  ModelTextDeltaHandler,
  ModelTextStreamRequest,
} from "./ports/language-model.port";
import type { ModelCapabilityCatalog } from "./model-profile";
import { PromptCachePolicyRegistry, type PromptCacheProjection } from "./prompt-cache-policy";
import { ProviderRegistry } from "./provider-registry";
import { TokenEstimatorRegistry } from "./ports/token-estimator.port";
import { outputLimitFor } from "./model-use-policy";
import { NOOP_AI_DEBUG_LOG, type AiDebugLogPort } from "./ports/ai-debug-log.port";

export const LANGUAGE_MODEL_GATEWAY = Symbol("LANGUAGE_MODEL_GATEWAY");
export const MODEL_CONFIG_PORT = Symbol("MODEL_CONFIG_PORT");
export const MODEL_PROFILE_REGISTRY = Symbol("MODEL_PROFILE_REGISTRY");
export const TOKEN_ESTIMATOR_REGISTRY = Symbol("TOKEN_ESTIMATOR_REGISTRY");

export class LanguageModelGateway implements LanguageModelPort {
  private readonly previous = new Map<string, PromptCacheProjection>();

  constructor(
    private readonly providers: ProviderRegistry,
    private readonly profiles: ModelCapabilityCatalog,
    private readonly cachePolicies: PromptCachePolicyRegistry,
    private readonly tokenEstimators: TokenEstimatorRegistry,
    private readonly debugLog: AiDebugLogPort = NOOP_AI_DEBUG_LOG,
  ) {}

  async complete(request: ModelCompletionRequest): Promise<ModelCompletion> {
    assertModelNotCancelled(request.signal);
    const prepared = await this.prepare(request);
    assertModelNotCancelled(request.signal);
    const completion = await this.providers.require(request.providerId).complete(prepared.request);
    this.logCompletion(request, completion, prepared.diagnostics);
    return { ...completion, cacheDiagnostics: prepared.diagnostics };
  }

  async streamText(
    request: ModelTextStreamRequest,
    onDelta: ModelTextDeltaHandler,
  ): Promise<ModelCompletion> {
    assertModelNotCancelled(request.signal);
    const profile = this.profiles.assertCapability(request.providerId, request.modelId, "streaming");
    const provider = this.providers.require(request.providerId);
    if (!provider.streamText) throw new Error("MODEL_STREAMING_UNAVAILABLE");
    const prepared = await this.prepare(request, profile);
    assertModelNotCancelled(request.signal);
    const completion = await provider.streamText(prepared.request, onDelta);
    this.logCompletion(request, completion, prepared.diagnostics);
    return { ...completion, cacheDiagnostics: prepared.diagnostics };
  }

  private async prepare(request: ModelCompletionRequest, existingProfile = this.profiles.resolve(
    request.providerId,
    request.modelId,
  )): Promise<{ request: ModelCompletionRequest; diagnostics?: PromptCacheProjection }> {
    if (request.maxOutputTokens !== undefined && (!Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens <= 0))
      throw new LanguageModelError("MODEL_MESSAGE_INVALID", "maxOutputTokens must be a positive integer", false, null, 0);
    if (request.maxAttempts !== undefined && (!Number.isSafeInteger(request.maxAttempts) || request.maxAttempts < 1 || request.maxAttempts > 3))
      throw new LanguageModelError("MODEL_MESSAGE_INVALID", "maxAttempts must be between 1 and 3", false, null, 0);
    if (request.tools?.length) this.profiles.assertCapability(request.providerId, request.modelId, "strictTools");
    const requestedOutputLimit = request.modelUse
      ? outputLimitFor(request.modelUse, existingProfile)
      : request.maxOutputTokens ?? existingProfile.capabilities.maxOutputTokens;
    if (!request.promptPlan) {
      return {
        request: {
          ...request,
          maxOutputTokens: Math.min(
            requestedOutputLimit,
            request.maxOutputTokens ?? requestedOutputLimit,
            existingProfile.capabilities.maxOutputTokens,
          ),
        },
      };
    }
    const key = [request.trace?.taskId, request.trace?.agentRunId, request.trace?.component]
      .filter(Boolean).join(":");
    const projection = this.cachePolicies.require(existingProfile.capabilities.cachePolicyId).project(
      request.promptPlan,
      {
        tokenizer: this.tokenEstimators.require(existingProfile.capabilities.tokenizerId),
        ...(key && this.previous.has(key) ? { previous: this.previous.get(key) } : {}),
      },
    );
    if (key) this.previous.set(key, projection);
    return {
      request: {
        ...request,
        messages: projection.messages,
        tools: projection.tools,
        maxOutputTokens: Math.min(
          requestedOutputLimit,
          request.maxOutputTokens ?? requestedOutputLimit,
          existingProfile.capabilities.maxOutputTokens,
        ),
      },
      diagnostics: projection,
    };
  }

  private logCompletion(
    request: ModelCompletionRequest,
    completion: ModelCompletion,
    diagnostics?: PromptCacheProjection,
  ): void {
    this.debugLog.write({
      event: "llm.gateway.usage",
      trace: request.trace,
      data: {
        providerId: request.providerId,
        modelId: request.modelId,
        attempt: completion.attempt,
        providerRequestId: completion.providerRequestId,
        usage: completion.usage,
        ...(diagnostics ? {
          stablePrefixFingerprint: diagnostics.stablePrefixFingerprint,
          toolSchemaFingerprint: diagnostics.toolSchemaFingerprint,
          cacheBoundaryReason: diagnostics.cacheBoundaryReason,
          estimatedInputTokens: diagnostics.estimatedInputTokens,
          longestCommonPrefixTokens: diagnostics.longestCommonPrefixTokens,
        } : {}),
      },
    });
  }
}
