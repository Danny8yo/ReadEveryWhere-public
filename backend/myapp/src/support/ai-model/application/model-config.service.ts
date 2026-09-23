import type { LanguageModelPort } from "./ports/language-model.port";
import type {
  DefaultModelConfig,
  ModelConfigPort,
} from "./ports/model-config.port";
import type { ModelCapabilityCatalog } from "./model-profile";

export class ModelConfigError extends Error {
  constructor(
    readonly kind: "validation" | "unsupported_model",
    message: string,
    readonly details: { field: string; reason?: string },
  ) {
    super(message);
    this.name = "ModelConfigError";
  }
}

export class ModelConfigService {
  constructor(
    private readonly modelConfigs: ModelConfigPort,
    private readonly languageModel: LanguageModelPort,
    private readonly modelCapabilities: ModelCapabilityCatalog,
    private readonly defaults: Readonly<DefaultModelConfig>,
  ) {}

  get(userId: number) {
    return this.modelConfigs.getPublic(userId);
  }

  save(userId: number, input: { apiKey?: string; modelId?: string }) {
    if (input.apiKey !== undefined && !input.apiKey.trim()) {
      throw new ModelConfigError("validation", "API key cannot be empty", { field: "apiKey" });
    }
    const current = this.modelConfigs.getPublic(userId);
    const modelId = input.modelId?.trim() || current.modelId;
    try {
      this.modelCapabilities.assertCapability(current.provider, modelId, "strictTools");
    } catch {
      throw new ModelConfigError(
        "unsupported_model",
        "Reasoning models are not supported by tool-based AI reading",
        { field: "modelId", reason: "DEEPSEEK_MODEL_UNSUPPORTED" },
      );
    }
    return this.modelConfigs.save(userId, input);
  }

  remove(userId: number) {
    return { deleted: this.modelConfigs.remove(userId) };
  }

  async test(userId: number, input: { apiKey?: string; modelId?: string }) {
    const stored = this.modelConfigs.getCredential(userId);
    const apiKey = input.apiKey?.trim() || stored?.apiKey;
    const modelId = input.modelId?.trim() || stored?.modelId || this.defaults.modelId;
    const providerId = stored?.provider ?? this.modelConfigs.getPublic(userId).provider;
    if (!apiKey) {
      throw new ModelConfigError(
        "validation",
        "DeepSeek API key is not configured",
        { field: "apiKey" },
      );
    }
    try {
      this.modelCapabilities.assertCapability(providerId, modelId, "strictTools");
    } catch {
      return { ok: false, modelId, latencyMs: 0, errorCode: "DEEPSEEK_MODEL_UNSUPPORTED" };
    }

    const startedAt = Date.now();
    try {
      await this.languageModel.complete({
        providerId,
        modelId,
        apiKey,
        temperature: 0,
        modelUse: "connectionTest",
        messages: [
          { role: "system", content: "Reply with the single word OK." },
          { role: "user", content: "Connection test" },
        ],
        timeoutMs: 15_000,
        trace: { component: "model-config-test" },
      });
      return { ok: true, modelId, latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        ok: false,
        modelId,
        latencyMs: Date.now() - startedAt,
        errorCode: errorCodeOf(error),
      };
    }
  }
}

function errorCodeOf(error: unknown): string {
  if (error && typeof error === "object") {
    if ("code" in error && typeof error.code === "string") return error.code;
    if (
      "details" in error
      && error.details
      && typeof error.details === "object"
      && "reason" in error.details
      && typeof error.details.reason === "string"
    ) {
      return error.details.reason;
    }
  }
  return "MODEL_CONNECTION_FAILED";
}
