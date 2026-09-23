export const AI_READING_LANGUAGE_MODEL_PORT = Symbol("AI_READING_LANGUAGE_MODEL_PORT");

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ModelSystemOrUserMessage {
  role: "system" | "user";
  content: string;
  toolCallId?: never;
  toolCalls?: never;
}

export interface ModelAssistantMessage {
  role: "assistant";
  content: string | null;
  toolCallId?: never;
  toolCalls?: ModelToolCall[];
}

export interface ModelToolMessage {
  role: "tool";
  content: string;
  toolCallId: string;
  toolCalls?: never;
}

export type ModelMessage =
  | ModelSystemOrUserMessage
  | ModelAssistantMessage
  | ModelToolMessage;

export interface ModelToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    strict: true;
  };
}

export interface PromptPlan {
  stablePrefix: ModelMessage[];
  appendOnlyHistory: ModelMessage[];
  dynamicTail: ModelMessage[];
  tools: ModelToolDefinition[];
  toolStage: string;
}

export interface ModelCompletionRequest {
  providerId: string;
  modelId: string;
  apiKey: string;
  messages: ModelMessage[];
  promptPlan?: PromptPlan;
  tools?: ModelToolDefinition[];
  temperature?: number;
  maxOutputTokens?: number;
  modelUse?: "toolLoop" | "finalAnswer";
  timeoutMs?: number;
  trace?: {
    component: "ai-reading";
    requestId?: string;
    taskId?: string;
    agentRunId?: string;
    modelCallId?: string;
    stepId?: string;
    toolCallId?: string;
  };
}

export type ModelTextStreamRequest = Omit<ModelCompletionRequest, "tools">;
export type ModelTextDeltaHandler = (delta: string) => void | Promise<void>;

export interface ModelUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadInputTokens?: number | null;
  cacheWriteInputTokens?: number | null;
  uncachedInputTokens?: number | null;
}

export interface ModelCacheDiagnostics {
  stablePrefixFingerprint: string;
  toolSchemaFingerprint: string;
  cacheBoundaryReason: string;
  estimatedInputTokens: number | null;
  longestCommonPrefixTokens: number | null;
}

export interface ModelCompletion {
  id: string;
  model: string;
  message: ModelAssistantMessage;
  usage: ModelUsage;
  finishReason: string | null;
  durationMs: number;
  attempt: number;
  providerRequestId?: string;
  cacheDiagnostics?: ModelCacheDiagnostics;
}

export interface LanguageModelPort {
  complete(request: ModelCompletionRequest): Promise<ModelCompletion>;
  streamText?(
    request: ModelTextStreamRequest,
    onDelta: ModelTextDeltaHandler,
  ): Promise<ModelCompletion>;
}

export type ModelErrorKind =
  | "timeout"
  | "rate_limited"
  | "invalid_response"
  | "auth_failed"
  | "capability_unsupported"
  | "network_error"
  | "unavailable";

export function languageModelErrorKind(error: unknown): ModelErrorKind | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { kind?: unknown; code?: unknown; providerCode?: unknown };
  if (isModelErrorKind(candidate.kind)) return candidate.kind;
  const code = typeof candidate.code === "string"
    ? candidate.code
    : typeof candidate.providerCode === "string"
      ? candidate.providerCode
      : null;
  return code ? modelErrorKind(code) : null;
}

export const AI_READING_MODEL_OUTPUT_LIMITS = Object.freeze({
  toolLoop: 16_384,
  finalAnswer: 16_384,
});

function isModelErrorKind(value: unknown): value is ModelErrorKind {
  return [
    "timeout",
    "rate_limited",
    "invalid_response",
    "auth_failed",
    "capability_unsupported",
    "network_error",
    "unavailable",
  ].includes(String(value));
}

function modelErrorKind(code: string): ModelErrorKind {
  if (/TIMEOUT/u.test(code)) return "timeout";
  if (/RATE_LIMIT/u.test(code)) return "rate_limited";
  if (/INVALID_RESPONSE/u.test(code)) return "invalid_response";
  if (/AUTH_FAILED/u.test(code)) return "auth_failed";
  if (/UNSUPPORTED/u.test(code)) return "capability_unsupported";
  if (/NETWORK/u.test(code)) return "network_error";
  return "unavailable";
}
