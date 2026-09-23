import { LanguageModelError } from "../../support/ai-model/public";
import { DeepSeekLanguageModelAdapter } from "./deepseek-language-model.adapter";

const request = {
  providerId: "deepseek", modelId: "deepseek-v4-flash",
  apiKey: "secret-key",
  messages: [{ role: "user" as const, content: "test" }],
  timeoutMs: 1_000,
};

describe("DeepSeekLanguageModelAdapter", () => {
  it("uses the DeepSeek beta endpoint when strict function tools are supplied", async () => {
    const fetchFn = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "call-strict",
      providerId: "deepseek", modelId: "deepseek-v4-flash",
      choices: [{ finish_reason: "stop", message: { role: "assistant", content: "OK" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const adapter = new DeepSeekLanguageModelAdapter(fetchFn, async () => undefined);

    await adapter.complete({
      ...request,
      tools: [{
        type: "function",
        function: {
          name: "complete_task",
          description: "Complete the task",
          parameters: { type: "object", properties: {}, additionalProperties: false },
          strict: true,
        },
      }],
    });

    expect(fetchFn.mock.calls[0][0]).toBe("https://api.deepseek.com/beta/chat/completions");
  });

  it("retries 429 and 5xx at most twice, then returns the valid completion", async () => {
    const fetchFn = jest.fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response("upstream failed", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "call-1",
        providerId: "deepseek", modelId: "deepseek-v4-flash",
        choices: [{
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            reasoning_content: "protocol continuation only",
            tool_calls: [{
              id: "tool-1",
              type: "function",
              function: { name: "book_toc", arguments: "{}" },
            }],
          },
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }), { status: 200, headers: { "content-type": "application/json" } }));
    const adapter = new DeepSeekLanguageModelAdapter(fetchFn, async () => undefined);

    const completion = await adapter.complete(request);

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(completion.attempt).toBe(3);
    expect(completion.message).toEqual({
      role: "assistant",
      content: null,
      reasoningContent: "protocol continuation only",
      toolCalls: [{ id: "tool-1", name: "book_toc", arguments: "{}" }],
    });
    expect(JSON.stringify(completion)).not.toContain("reasoning_content");
    const headers = (fetchFn.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret-key");
  });

  it("does not retry non-429 4xx responses and never exposes the upstream body", async () => {
    const fetchFn = jest.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: { message: "bad secret-key" } }),
      { status: 401 },
    ));
    const adapter = new DeepSeekLanguageModelAdapter(fetchFn, async () => undefined);

    await expect(adapter.complete(request)).rejects.toMatchObject<Partial<LanguageModelError>>({
      code: "DEEPSEEK_AUTH_FAILED",
      retryable: false,
      status: 401,
      attempt: 1,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await adapter.complete(request).catch((error: LanguageModelError) => {
      expect(error.message).not.toContain("secret-key");
    });
  });

  it("maps an aborted request to a stable retryable timeout error", async () => {
    const fetchFn = jest.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const adapter = new DeepSeekLanguageModelAdapter(fetchFn, async () => undefined);

    await expect(adapter.complete({ ...request, timeoutMs: 1 })).rejects.toMatchObject({
      code: "DEEPSEEK_TIMEOUT",
      retryable: true,
    });
  });

  it("shares one total deadline across upstream retry attempts", async () => {
    let now = 0;
    const fetchFn = jest.fn(async () => {
      now += 600;
      return new Response("upstream failed", { status: 503 });
    });
    const sleep = jest.fn(async (milliseconds: number) => { now += milliseconds; });
    const adapter = new DeepSeekLanguageModelAdapter(fetchFn, sleep, () => now);

    await expect(adapter.complete({ ...request, timeoutMs: 1_000 })).rejects.toMatchObject({
      code: "DEEPSEEK_TIMEOUT",
      retryable: true,
      attempt: 2,
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("keeps the deadline active until the response body has been read", async () => {
    let signal: AbortSignal | null = null;
    const fetchFn = jest.fn(async (_url: string, init?: RequestInit) => {
      signal = init?.signal ?? null;
      return {
        ok: true,
        status: 200,
        json: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          if (signal?.aborted) throw new DOMException("aborted", "AbortError");
          return {
            id: "late-body",
            providerId: "deepseek", modelId: "deepseek-v4-flash",
            choices: [{ finish_reason: "stop", message: { role: "assistant", content: "late" } }],
          };
        },
      } as Response;
    });
    const adapter = new DeepSeekLanguageModelAdapter(fetchFn, async () => undefined);

    await expect(adapter.complete({ ...request, timeoutMs: 1 })).rejects.toMatchObject({
      code: "DEEPSEEK_TIMEOUT",
      retryable: true,
    });
  });
});
