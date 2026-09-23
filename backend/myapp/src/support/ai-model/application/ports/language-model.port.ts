export type ModelMessageRole = "system" | "user" | "assistant" | "tool";

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
  /** Provider continuation, used only in subsequent model requests; never public answer text. */
  reasoningContent?: string;
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

export interface ModelCompletionRequest {
  providerId: string;
  modelId: string;
  apiKey: string;
  messages: ModelMessage[];
  promptPlan?: import("../prompt-cache-policy").PromptPlan;
  tools?: ModelToolDefinition[];
  /** Planning may require a tool decision; providers reject unsupported combinations. */
  toolChoice?: "auto" | "required";
  temperature?: number;
  maxOutputTokens?: number;
  modelUse?: "toolLoop" | "finalAnswer" | "bookClassification" | "connectionTest" | "metadataExtraction" | "selectionQa";
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Maximum HTTP attempts, including malformed-response retries; default provider policy. */
  maxAttempts?: number;
  trace?: AiDebugTraceContext;
}

export type ModelTextStreamRequest = Omit<ModelCompletionRequest, "tools" | "toolChoice">;
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

export class LanguageModelError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly status: number | null,
    public readonly attempt: number,
    public readonly kind: ModelErrorKind = modelErrorKind(code),
    public readonly providerId: string | null = null,
    public readonly providerCode: string | null = code,
  ) {
    super(message);
  }
}

export type ModelErrorKind =
  | "cancelled"
  | "timeout"
  | "rate_limited"
  | "invalid_response"
  | "auth_failed"
  | "capability_unsupported"
  | "network_error"
  | "unavailable";

export function languageModelErrorKind(error: unknown): ModelErrorKind | null {
  if (error instanceof LanguageModelError) return error.kind;
  if (!error || typeof error !== "object") return null;
  const candidate = error as { code?: unknown; providerCode?: unknown };
  const code = typeof candidate.code === "string"
    ? candidate.code
    : typeof candidate.providerCode === "string"
      ? candidate.providerCode
      : null;
  return code ? modelErrorKind(code) : null;
}

function modelErrorKind(code: string): ModelErrorKind {
  if (/CANCELLED/u.test(code)) return "cancelled";
  if (/TIMEOUT/u.test(code)) return "timeout";
  if (/RATE_LIMIT/u.test(code)) return "rate_limited";
  if (/INVALID_RESPONSE/u.test(code)) return "invalid_response";
  if (/AUTH_FAILED/u.test(code)) return "auth_failed";
  if (/UNSUPPORTED/u.test(code)) return "capability_unsupported";
  if (/NETWORK/u.test(code)) return "network_error";
  return "unavailable";
}
import type { AiDebugTraceContext } from "./ai-debug-log.port";

export function assertModelNotCancelled(signal?: AbortSignal, attempt = 0): void {
  if (signal?.aborted) throw new LanguageModelError(
    "MODEL_CANCELLED", "Model request cancelled", false, null, attempt, "cancelled",
  );
}
