import { Logger } from "@nestjs/common";
import {
  LanguageModelPort,
  ModelConfigPort,
  ModelCapabilityCatalog,
  TokenEstimatorCatalog,
  ModelMessage,
} from "../../../../support/ai-model/public";
import {
  QaModelPort,
  QaModelSnapshot,
  QaModelInput,
  QA_POLICY,
} from "../application/selection-qa-runtime.port";
import { SelectionQaError } from "../application/selection-qa.types";
export class SelectionQaModelAdapter implements QaModelPort {
  private readonly logger = new Logger(SelectionQaModelAdapter.name);
  constructor(
    private readonly models: LanguageModelPort,
    private readonly configs: ModelConfigPort,
    private readonly profiles: ModelCapabilityCatalog,
    private readonly tokenizers: TokenEstimatorCatalog,
  ) {}
  snapshot(userId: number): QaModelSnapshot {
    const config = this.configs.getPublic(userId);
    if (!config.hasApiKey)
      throw new SelectionQaError("MODEL_NOT_CONFIGURED", 409);
    const profile = this.profiles.assertCapability(
      config.provider,
      config.modelId,
      "strictTools",
    );
    this.profiles.assertCapability(
      config.provider,
      config.modelId,
      "streaming",
    );
    this.tokenizers.require(profile.capabilities.tokenizerId);
    return {
      version: 1,
      providerId: config.provider,
      modelId: config.modelId,
      configUpdatedAt: config.updatedAt,
      tokenizerId: profile.capabilities.tokenizerId,
      contextWindowTokens: profile.capabilities.contextWindowTokens,
      maxOutputTokens: profile.capabilities.maxOutputTokens,
      policyVersion: QA_POLICY.version,
    };
  }
  count(snapshot: QaModelSnapshot, text: string) {
    return this.tokenizers.require(snapshot.tokenizerId).count(text);
  }
  private request(
    userId: number,
    snapshot: QaModelSnapshot,
    input: QaModelInput,
  ) {
    const config = this.configs.getPublic(userId);
    if (
      !config.hasApiKey ||
      config.provider !== snapshot.providerId ||
      config.modelId !== snapshot.modelId ||
      config.updatedAt !== snapshot.configUpdatedAt
    )
      throw new SelectionQaError("MODEL_CONFIG_CHANGED");
    const credential = this.configs.getCredential(userId);
    if (credential === null) throw new SelectionQaError("MODEL_NOT_CONFIGURED");
    return {
      providerId: snapshot.providerId,
      modelId: snapshot.modelId,
      apiKey: credential.apiKey,
      messages: input.messages as ModelMessage[],
      tools: input.tools,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      maxAttempts: 1,
      maxOutputTokens: input.maxOutputTokens,
      modelUse: "selectionQa" as const,
    };
  }
  async complete(
    userId: number,
    snapshot: QaModelSnapshot,
    input: QaModelInput,
  ) {
    const startedAt = Date.now();
    const profile = this.profiles.resolve(snapshot.providerId, snapshot.modelId);
    const result = await this.models.complete(
      {
        ...this.request(userId, snapshot, input),
        // One reserved model call is one provider attempt. Recovery must return
        // to the host so any subsequent call is charged to the persisted budget.
        maxAttempts: 1,
        toolChoice: profile.capabilities.reasoning ? "auto" : "required",
      },
    );
    this.logger.log({ event: "selection_qa.model_plan", turnId: input.turnId, model: snapshot.modelId, elapsedMs: Date.now() - startedAt, toolCalls: result.message.toolCalls?.length ?? 0, discardedContentChars: result.message.content?.length ?? 0, usage: { promptTokens: result.usage.promptTokens, completionTokens: result.usage.completionTokens } });
    return { toolCalls: result.message.toolCalls ?? [], content: result.message.content, reasoningContent: result.message.reasoningContent, usage: { promptTokens: result.usage.promptTokens, completionTokens: result.usage.completionTokens, totalTokens: result.usage.totalTokens } };
  }
  async stream(
    userId: number,
    snapshot: QaModelSnapshot,
    input: QaModelInput,
    onDelta: (text: string) => Promise<void>,
  ) {
    if (!this.models.streamText)
      throw new SelectionQaError("MODEL_STREAMING_UNAVAILABLE");
    const { tools, ...request } = this.request(userId, snapshot, input);
    const startedAt = Date.now();
    let chunks = 0, chars = 0, firstDeltaAt: number | null = null, lastDeltaAt: number | null = null;
    let completed = false;
    try {
    const result = await this.models.streamText(request, async text => {
      lastDeltaAt = Date.now();
      if (firstDeltaAt === null) {
        firstDeltaAt = lastDeltaAt;
        this.logger.log({ event: "selection_qa.model_first_delta", turnId: input.turnId, model: snapshot.modelId, at: firstDeltaAt, elapsedMs: firstDeltaAt - startedAt });
      }
      chunks++; chars += text.length;
      await onDelta(text);
    });
    completed = true;
    return { usage: { promptTokens: result.usage.promptTokens, completionTokens: result.usage.completionTokens, totalTokens: result.usage.totalTokens }, finishReason: result.finishReason };
    } finally {
      this.logger.log({ event: "selection_qa.model_stream", turnId: input.turnId, model: snapshot.modelId, startedAt, firstDeltaAt, lastDeltaAt, elapsedMs: Date.now() - startedAt, chunks, chars, completed });
    }
  }
}
