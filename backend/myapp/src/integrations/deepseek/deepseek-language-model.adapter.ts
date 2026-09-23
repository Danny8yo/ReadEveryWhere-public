import { createHash } from "node:crypto";
import { isDeepSeekReasoningModel } from "./deepseek-model-policy";
import {
  LanguageModelError,
  assertModelNotCancelled,
  NOOP_AI_DEBUG_LOG,
  type AiDebugLogPort,
  type LanguageModelPort,
  type ModelCompletion,
  type ModelCompletionRequest,
  type ModelMessage,
  type ModelTextDeltaHandler,
  type ModelTextStreamRequest,
  type ModelToolCall,
  type ModelProvider,
} from "../../support/ai-model/public";

const DEEPSEEK_CHAT_COMPLETIONS_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_BETA_CHAT_COMPLETIONS_URL = "https://api.deepseek.com/beta/chat/completions";
const MAX_ATTEMPTS = 3;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type Sleep = (milliseconds: number) => Promise<void>;
class DeltaHandlerFailure { constructor(readonly original: unknown) {} }

interface DeepSeekResponse {
  id?: unknown;
  model?: unknown;
  choices?: Array<{
    finish_reason?: unknown;
    message?: {
      role?: unknown;
      content?: unknown;
      reasoning_content?: unknown;
      tool_calls?: Array<{
        id?: unknown;
        function?: { name?: unknown; arguments?: unknown };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
    prompt_cache_hit_tokens?: unknown;
    prompt_cache_miss_tokens?: unknown;
  };
}

interface DeepSeekStreamChunk {
  id?: unknown;
  model?: unknown;
  choices?: Array<{
    finish_reason?: unknown;
    delta?: { content?: unknown };
  }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
    prompt_cache_hit_tokens?: unknown;
    prompt_cache_miss_tokens?: unknown;
  };
}

export class DeepSeekLanguageModelAdapter implements LanguageModelPort, ModelProvider {
  readonly providerId = "deepseek";
  constructor(
    private readonly fetchFn: FetchLike = fetch,
    private readonly sleep?: Sleep,
    private readonly now: () => number = Date.now,
    private readonly debugLog: AiDebugLogPort = NOOP_AI_DEBUG_LOG,
  ) {}

  async complete(request: ModelCompletionRequest): Promise<ModelCompletion> {
    assertModelNotCancelled(request.signal);
    this.validateRequest(request);
    this.debugLog.write({
      event: "llm.request",
      trace: request.trace,
      data: {
        providerId: request.providerId,
        modelId: request.modelId,
        messageCount: request.messages.length,
        messageCharacters: request.messages.reduce((total, message) => total + (message.content?.length ?? 0), 0),
        toolNames: request.tools?.map((tool) => tool.function.name) ?? [],
        timeoutMs: request.timeoutMs ?? 60_000,
      },
      secrets: [request.apiKey],
    });
    try {
      const completion = await this.completeWithRetry(request);
      this.debugLog.write({
        event: "llm.response",
        trace: request.trace,
        data: {
          providerId: request.providerId,
          modelId: completion.model,
          providerRequestId: completion.providerRequestId,
          usage: completion.usage,
          finishReason: completion.finishReason,
          durationMs: completion.durationMs,
          attempt: completion.attempt,
        },
        secrets: [request.apiKey],
      });
      return completion;
    } catch (error) {
      this.debugLog.write({
        event: "llm.error",
        trace: request.trace,
        data: modelErrorRecord(error),
        secrets: [request.apiKey],
      });
      throw error;
    }
  }

  async streamText(
    request: ModelTextStreamRequest,
    onDelta: ModelTextDeltaHandler,
  ): Promise<ModelCompletion> {
    assertModelNotCancelled(request.signal);
    this.validateRequest(request);
    this.debugLog.write({
      event: "llm.stream.request",
      trace: request.trace,
      data: {
        providerId: request.providerId,
        modelId: request.modelId,
        messageCount: request.messages.length,
        messageCharacters: request.messages.reduce((total, message) => total + (message.content?.length ?? 0), 0),
        timeoutMs: request.timeoutMs ?? 60_000,
      },
      secrets: [request.apiKey],
    });
    try {
      const completion = await this.streamWithRetry(request, onDelta);
      this.debugLog.write({
        event: "llm.stream.response",
        trace: request.trace,
        data: {
          id: completion.id,
          model: completion.model,
          contentCharacters: completion.message.content?.length ?? 0,
          usage: completion.usage,
          finishReason: completion.finishReason,
          durationMs: completion.durationMs,
        },
        secrets: [request.apiKey],
      });
      return completion;
    } catch (error) {
      const normalized = error;
      this.debugLog.write({
        event: "llm.stream.error",
        trace: request.trace,
        data: modelErrorRecord(normalized),
        secrets: [request.apiKey],
      });
      throw normalized;
    }
  }

  private async streamWithRetry(
    request: ModelTextStreamRequest,
    onDelta: ModelTextDeltaHandler,
  ): Promise<ModelCompletion> {
    return this.withRetry(request, async (response, attempt, startedAt, signal, markPublished) =>
      this.readTextStream(response, request.modelId, attempt, startedAt, async delta => {
        markPublished();
        try { await onDelta(delta); } catch (error) { throw new DeltaHandlerFailure(error); }
      }, signal), true);
  }

  private async completeWithRetry(request: ModelCompletionRequest): Promise<ModelCompletion> {
    return this.withRetry(request, async (response, attempt, startedAt) => {
      const body = await this.readJson(response, attempt);
      return this.toCompletion(body, request.modelId, attempt, this.now() - startedAt,
        response.headers.get("x-request-id") ?? undefined);
    }, false);
  }

  private async withRetry(
    request: ModelCompletionRequest,
    consume: (response: Response, attempt: number, startedAt: number, signal: AbortSignal, markPublished: () => void) => Promise<ModelCompletion>,
    streaming: boolean,
  ): Promise<ModelCompletion> {
    const startedAt = this.now();
    const deadline = startedAt + (request.timeoutMs ?? 60_000);
    const maxAttempts = request.maxAttempts ?? MAX_ATTEMPTS;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      assertModelNotCancelled(request.signal, attempt);
      const remainingMs = deadline - this.now();
      if (remainingMs <= 0) throw this.timeoutError(attempt);
      const controller = new AbortController();
      const cancel = () => controller.abort(request.signal!.reason);
      request.signal?.addEventListener("abort", cancel, { once: true });
      const timeout = setTimeout(() => controller.abort(), remainingMs);
      let publishedDelta = false;
      let retryAfter: number | undefined;
      try {
        assertModelNotCancelled(request.signal, attempt);
        const response = await (streaming ? this.postStream(request, controller.signal) : this.post(request, controller.signal));
        assertModelNotCancelled(request.signal, attempt);
        if (!response.ok) {
          retryAfter = this.retryAfterMs(response);
          const reader = response.body?.getReader();
          let errorText = "";
          if (reader) {
            try {
              const decoder = new TextDecoder();
              while (errorText.length < 4096) { const chunk = await reader.read(); if (chunk.done) break; errorText += decoder.decode(chunk.value).slice(0, 4096 - errorText.length); }
            } finally { await reader.cancel(); reader.releaseLock(); }
          }
          // Record protocol categories only; provider error bodies may echo private inputs.
          this.debugLog.write({ event: "llm.http_rejected", data: { status: response.status,
            categories: ["reasoning_content", "tool_call_id", "tool_calls", "assistant", "user", "content", "strict", "prefix", "insufficient", "last message", "must be", "must not", "function", "name", "JSON", "invalid", "missing"].filter(word => errorText.toLowerCase().includes(word.toLowerCase())),
            messageShape: request.messages.map(m => ({ role: m.role, toolCalls: m.toolCalls?.length ?? 0, hasContinuation: m.role === "assistant" && m.reasoningContent !== undefined })),
            bodySha256: createHash("sha256").update(errorText).digest("hex") } });
          throw this.httpError(response.status, response.status === 429 || response.status >= 500, attempt);
        }
        const completion = await consume(response, attempt, startedAt, controller.signal, () => { publishedDelta = true; });
        assertModelNotCancelled(request.signal, attempt);
        if (controller.signal.aborted) throw this.timeoutError(attempt);
        return completion;
      } catch (error) {
        // Once a delta was delivered, callback/lease failures must retain their
        // original identity and must never cause a second billable request.
        if (error instanceof DeltaHandlerFailure) throw error.original;
        assertModelNotCancelled(request.signal, attempt);
        const normalized = controller.signal.aborted ? this.timeoutError(attempt)
          : error instanceof LanguageModelError ? error : this.transportError(error, attempt, streaming);
        if (publishedDelta) throw normalized;
        const mayRetry = normalized.kind === "invalid_response"
          ? attempt < Math.min(2, maxAttempts)
          : normalized.retryable && attempt < maxAttempts;
        if (!mayRetry) throw normalized;
        // Stop the attempt's connection before entering backoff.
        controller.abort();
        clearTimeout(timeout);
        request.signal?.removeEventListener("abort", cancel);
        if (normalized.kind !== "invalid_response"
          && !await this.waitBeforeRetry(attempt, deadline, retryAfter, request.signal)) throw this.timeoutError(attempt);
      } finally {
        controller.abort();
        clearTimeout(timeout);
        request.signal?.removeEventListener("abort", cancel);
      }
    }
    throw new LanguageModelError("DEEPSEEK_UNAVAILABLE", "DeepSeek is unavailable", true, null, maxAttempts);
  }

  private async post(request: ModelCompletionRequest, signal: AbortSignal): Promise<Response> {
    const usesStrictTools = request.tools?.some((tool) => tool.function.strict) ?? false;
    return this.fetchFn(
      usesStrictTools ? DEEPSEEK_BETA_CHAT_COMPLETIONS_URL : DEEPSEEK_CHAT_COMPLETIONS_URL,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${request.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: request.modelId,
          thinking: { type: isDeepSeekReasoningModel(request.modelId) ? "enabled" : "disabled" },
          messages: request.messages.map((message) => this.toUpstreamMessage(message)),
          tools: request.tools,
          tool_choice: request.tools?.length ? (request.toolChoice ?? "auto") : undefined,
          temperature: request.temperature,
          max_tokens: request.maxOutputTokens,
          stream: false,
        }),
        signal,
      },
    );
  }

  private async postStream(request: ModelTextStreamRequest, signal: AbortSignal): Promise<Response> {
    return this.fetchFn(DEEPSEEK_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${request.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: request.modelId,
        thinking: { type: isDeepSeekReasoningModel(request.modelId) ? "enabled" : "disabled" },
        messages: request.messages.map((message) => this.toUpstreamMessage(message)),
        temperature: request.temperature,
        max_tokens: request.maxOutputTokens,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal,
    });
  }

  private async readTextStream(
    response: Response,
    requestedModel: string,
    attempt: number,
    startedAt: number,
    onDelta: ModelTextDeltaHandler,
    signal: AbortSignal,
  ): Promise<ModelCompletion> {
    if (!response.body) {
      throw new LanguageModelError("DEEPSEEK_INVALID_RESPONSE", "DeepSeek stream has no body", false, response.status, attempt);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let id = "unknown";
    let model = requestedModel;
    let finishReason: string | null = null;
    let usage = emptyUsage();

    const consumeLine = async (line: string) => {
      signal.throwIfAborted();
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") return;
      let chunk: DeepSeekStreamChunk;
      try {
        chunk = JSON.parse(data) as DeepSeekStreamChunk;
      } catch {
        throw new LanguageModelError("DEEPSEEK_INVALID_RESPONSE", "DeepSeek returned malformed stream data", false, response.status, attempt);
      }
      if (typeof chunk.id === "string") id = chunk.id;
      if (typeof chunk.model === "string") model = chunk.model;
      const choice = chunk.choices?.[0];
      const delta = typeof choice?.delta?.content === "string" ? choice.delta.content : "";
      if (delta) {
        content += delta;
        await onDelta(delta);
        signal.throwIfAborted();
      }
      if (typeof choice?.finish_reason === "string") finishReason = choice.finish_reason;
      if (chunk.usage) {
        usage = this.normalizeUsage(chunk.usage);
      }
    };

    const cancelReader = () => { void reader.cancel(signal.reason).catch(() => undefined); };
    signal.addEventListener("abort", cancelReader, { once: true });
    try {
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        signal.throwIfAborted();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split(/\r?\n/gu);
        buffer = lines.pop() ?? "";
        for (const line of lines) await consumeLine(line);
        if (done) break;
      }
      if (buffer.trim()) await consumeLine(buffer);
    } finally {
      signal.removeEventListener("abort", cancelReader);
      // Cancellation is cleanup, and its failure must not hide the original
      // stream/callback failure. releaseLock always runs after pending reads.
      try { await reader.cancel(); } catch { /* already errored or aborted */ }
      reader.releaseLock();
    }

    return {
      id,
      model,
      message: { role: "assistant", content },
      usage,
      finishReason,
      durationMs: this.now() - startedAt,
      attempt,
      providerRequestId: response.headers.get("x-request-id") ?? (id === "unknown" ? undefined : id),
    };
  }

  private toUpstreamMessage(message: ModelMessage): Record<string, unknown> {
    const output: Record<string, unknown> = { role: message.role, content: message.content };
    if (message.role === "assistant" && message.reasoningContent !== undefined) output.reasoning_content = message.reasoningContent;
    if (message.toolCallId) output.tool_call_id = message.toolCallId;
    if (message.toolCalls) {
      output.tool_calls = message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      }));
    }
    return output;
  }

  private async readJson(response: Response, attempt: number): Promise<DeepSeekResponse> {
    let body = "";
    try {
      body = await response.text();
      if (!body.trim()) throw new SyntaxError("empty response body");
      return JSON.parse(body) as DeepSeekResponse;
    } catch (error) {
      if (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError") {
        throw error;
      }
      this.debugLog.write({
        event: "llm.invalid_response",
        data: {
          providerId: this.providerId,
          attempt,
          status: response.status,
          contentType: response.headers.get("content-type"),
          bodyBytes: Buffer.byteLength(body),
          bodySha256: createHash("sha256").update(body).digest("hex"),
          providerRequestId: response.headers.get("x-request-id"),
          parseStage: "json",
        },
      });
      throw new LanguageModelError(
        "DEEPSEEK_INVALID_RESPONSE",
        "DeepSeek returned an invalid JSON response",
        false,
        response.status,
        attempt,
        "invalid_response",
        this.providerId,
        "INVALID_JSON",
      );
    }
  }

  private toCompletion(
    response: DeepSeekResponse,
    requestedModel: string,
    attempt: number,
    durationMs: number,
    providerRequestId?: string,
  ): ModelCompletion {
    const choice = response.choices?.[0];
    const upstreamMessage = choice?.message;
    if (!upstreamMessage) {
      throw new LanguageModelError(
        "DEEPSEEK_INVALID_RESPONSE",
        "DeepSeek response has no assistant message",
        false,
        200,
        attempt,
      );
    }

    const toolCalls: ModelToolCall[] | undefined = upstreamMessage.tool_calls?.map((call, index) => ({
      id: typeof call.id === "string" ? call.id : `tool-${index + 1}`,
      name: typeof call.function?.name === "string" ? call.function.name : "",
      arguments: typeof call.function?.arguments === "string" ? call.function.arguments : "{}",
    }));
    if (toolCalls?.some((call) => !call.name)) {
      throw new LanguageModelError(
        "DEEPSEEK_INVALID_RESPONSE",
        "DeepSeek returned a malformed tool call",
        false,
        200,
        attempt,
      );
    }

    const content = typeof upstreamMessage.content === "string" ? upstreamMessage.content : null;
    return {
      id: typeof response.id === "string" ? response.id : "unknown",
      model: typeof response.model === "string" ? response.model : requestedModel,
      message: {
        role: "assistant",
        content,
        ...(toolCalls?.length ? { toolCalls } : {}),
        ...(typeof upstreamMessage.reasoning_content === "string" ? { reasoningContent: upstreamMessage.reasoning_content } : {}),
      },
      usage: this.normalizeUsage(response.usage),
      finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : null,
      durationMs,
      attempt,
      providerRequestId: providerRequestId ?? (typeof response.id === "string" ? response.id : undefined),
    };
  }

  private httpError(status: number, retryable: boolean, attempt: number): LanguageModelError {
    const code = status === 401 || status === 403
      ? "DEEPSEEK_AUTH_FAILED"
      : status === 429
        ? "DEEPSEEK_RATE_LIMITED"
        : status >= 500
          ? "DEEPSEEK_UPSTREAM_ERROR"
          : "DEEPSEEK_REQUEST_REJECTED";
    return new LanguageModelError(
      code,
      `DeepSeek request failed with status ${status}`,
      retryable,
      status,
      attempt,
      status === 401 || status === 403 ? "auth_failed" : status === 429 ? "rate_limited" : "unavailable",
      this.providerId,
      code,
    );
  }

  private retryDelayMs(attempt: number): number {
    return Math.min(250 * (2 ** (attempt - 1)), 1_000);
  }

  private async waitBeforeRetry(
    attempt: number,
    deadline: number,
    retryAfterMs?: number,
    signal?: AbortSignal,
  ): Promise<boolean> {
    assertModelNotCancelled(signal, attempt);
    const remainingMs = deadline - this.now();
    if (remainingMs <= 0) return false;
    const delayMs = Math.max(this.retryDelayMs(attempt), retryAfterMs ?? 0);
    if (delayMs >= remainingMs) return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    try {
      const delay = this.sleep ? this.sleep(delayMs) : new Promise<void>(resolve => { timer = setTimeout(resolve, delayMs); });
      if (signal) await Promise.race([delay, new Promise<never>((_, reject) => {
        cancel = () => { try { assertModelNotCancelled(signal, attempt); } catch (error) { reject(error); } };
        signal.addEventListener("abort", cancel, { once: true });
        if (signal.aborted) cancel();
      })]);
      else await delay;
      assertModelNotCancelled(signal, attempt);
      return this.now() < deadline;
    } finally {
      clearTimeout(timer);
      if (cancel) signal!.removeEventListener("abort", cancel);
    }
  }

  private retryAfterMs(response: Response): number | undefined {
    const value = response.headers.get("Retry-After")?.trim();
    if (!value) return undefined;
    if (/^\d+(?:\.\d+)?$/u.test(value)) {
      const milliseconds = Number(value) * 1_000;
      return Number.isFinite(milliseconds) ? Math.max(0, Math.ceil(milliseconds)) : undefined;
    }
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? Math.max(0, timestamp - this.now()) : undefined;
  }

  private validateRequest(request: ModelCompletionRequest): void {
    if (request.toolChoice !== undefined) {
      if (!["auto", "required"].includes(request.toolChoice) || !request.tools?.length)
        throw this.requestValidationError("toolChoice requires nonempty tools and must be auto or required");
      if (request.toolChoice === "required" && isDeepSeekReasoningModel(request.modelId))
        throw new LanguageModelError("MODEL_CAPABILITY_UNSUPPORTED", "DeepSeek thinking mode does not support required tool choice", false, null, 0);
    }
    if (request.maxAttempts !== undefined && (!Number.isSafeInteger(request.maxAttempts) || request.maxAttempts < 1 || request.maxAttempts > MAX_ATTEMPTS))
      throw this.requestValidationError("maxAttempts must be between 1 and 3");
    if (request.temperature !== undefined
      && (!Number.isFinite(request.temperature) || request.temperature < 0 || request.temperature > 2)) {
      throw this.requestValidationError("temperature must be between 0 and 2");
    }
    if (request.maxOutputTokens !== undefined
      && (!Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens <= 0)) {
      throw this.requestValidationError("maxOutputTokens must be a positive integer");
    }
    for (const message of request.messages) {
      if (message.role === "tool"
        && (typeof message.content !== "string" || !message.toolCallId?.trim())) {
        throw this.requestValidationError("tool messages require string content and toolCallId");
      }
    }
  }

  private requestValidationError(message: string): LanguageModelError {
    return new LanguageModelError("MODEL_MESSAGE_INVALID", message, false, null, 1);
  }

  private transportError(error: unknown, attempt: number, streaming: boolean): LanguageModelError {
    const timeout = typeof error === "object" && error !== null
      && "name" in error && error.name === "AbortError";
    return new LanguageModelError(
      timeout ? "DEEPSEEK_TIMEOUT" : "DEEPSEEK_NETWORK_ERROR",
      timeout
        ? "DeepSeek request timed out"
        : streaming ? "DeepSeek streaming request failed" : "DeepSeek request failed",
      true,
      null,
      attempt,
    );
  }

  private timeoutError(attempt: number): LanguageModelError {
    return new LanguageModelError(
      "DEEPSEEK_TIMEOUT",
      "DeepSeek request timed out",
      true,
      null,
      attempt,
    );
  }

  private numberOrZero(value: unknown): number {
    return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
  }

  private numberOrNull(value: unknown): number | null {
    return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
  }

  private normalizeUsage(value: DeepSeekResponse["usage"]): ModelCompletion["usage"] {
    const promptTokens = this.numberOrZero(value?.prompt_tokens);
    const cacheReadInputTokens = this.numberOrNull(value?.prompt_cache_hit_tokens);
    const uncachedInputTokens = this.numberOrNull(value?.prompt_cache_miss_tokens);
    if (cacheReadInputTokens !== null && uncachedInputTokens !== null
      && cacheReadInputTokens + uncachedInputTokens !== promptTokens) {
      this.debugLog.write({
        event: "llm.usage_inconsistent",
        data: { providerId: this.providerId, promptTokens, cacheReadInputTokens, uncachedInputTokens },
      });
    }
    return {
      promptTokens,
      completionTokens: this.numberOrZero(value?.completion_tokens),
      totalTokens: this.numberOrZero(value?.total_tokens),
      cacheReadInputTokens,
      cacheWriteInputTokens: null,
      uncachedInputTokens,
    };
  }
}

function emptyUsage(): ModelCompletion["usage"] {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cacheReadInputTokens: null,
    cacheWriteInputTokens: null,
    uncachedInputTokens: null,
  };
}

function modelErrorRecord(error: unknown): Record<string, unknown> {
  if (error instanceof LanguageModelError) {
    return {
      name: error.name,
      message: error.message,
      code: error.code,
      retryable: error.retryable,
      status: error.status,
      attempt: error.attempt,
      kind: error.kind,
      providerId: error.providerId,
      providerCode: error.providerCode,
    };
  }
  return {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
  };
}
