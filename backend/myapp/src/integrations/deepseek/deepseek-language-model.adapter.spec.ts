import { DeepSeekLanguageModelAdapter } from "./deepseek-language-model.adapter";

describe("DeepSeekLanguageModelAdapter debug log", () => {
  it("retries an HTTP 200 response with an empty JSON body once before publishing a decision", async () => {
    const fetchFn = jest.fn()
      .mockResolvedValueOnce(new Response("", { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(completionResponse("OK"));
    const adapter = new DeepSeekLanguageModelAdapter(fetchFn, async () => undefined);
    const result = await adapter.complete({ providerId: "deepseek", modelId: "deepseek-v4-flash", apiKey: "test-key", messages: [{ role: "user", content: "test" }], maxAttempts: 2 });
    expect(result.message.content).toBe("OK");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
  it.each([
    ["deepseek-v4-flash", "disabled"],
    ["deepseek-flash", "disabled"],
    ["deepseek-chat", "disabled"],
    ["deepseek-reasoner", "enabled"],
    ["deepseek-r1", "enabled"],
  ])("explicitly selects %s thinking mode for complete and stream requests", async (modelId, thinkingType) => {
    const fetchFn = jest.fn()
      .mockResolvedValueOnce(completionResponse("OK"))
      .mockResolvedValueOnce(streamResponse("OK"));
    const adapter = new DeepSeekLanguageModelAdapter(fetchFn, async () => undefined);
    const request = {
      providerId: "deepseek", modelId, apiKey: "test-key",
      messages: [{ role: "user" as const, content: "test" }],
    };
    await adapter.complete(request);
    await adapter.streamText(request, () => undefined);
    const bodies = fetchFn.mock.calls.map(call => JSON.parse(String(call[1].body)));
    expect(bodies).toEqual([
      expect.objectContaining({ model: modelId, thinking: { type: thinkingType }, stream: false }),
      expect.objectContaining({ model: modelId, thinking: { type: thinkingType }, stream: true }),
    ]);
  });

  it.each([
    ["deepseek-v4-flash", false],
    ["deepseek-reasoner", true],
  ])("validates required tool choice for %s before HTTP", async (modelId, rejected) => {
    const fetchFn = jest.fn().mockResolvedValue(completionResponse("OK"));
    const adapter = new DeepSeekLanguageModelAdapter(fetchFn);
    const request = {
      providerId: "deepseek", modelId, apiKey: "test-key",
      messages: [{ role: "user" as const, content: "test" }],
      tools: [{ type: "function" as const, function: { name: "finish", description: "finish", parameters: { type: "object", properties: {} }, strict: true as const } }],
      toolChoice: "required" as const,
    };
    if (rejected) {
      await expect(adapter.complete(request)).rejects.toMatchObject({ code: "MODEL_CAPABILITY_UNSUPPORTED" });
      expect(fetchFn).not.toHaveBeenCalled();
    } else {
      await adapter.complete(request);
      expect(JSON.parse(String(fetchFn.mock.calls[0][1].body)).tool_choice).toBe("required");
      await expect(adapter.complete({ ...request, tools: [] })).rejects.toMatchObject({ code: "MODEL_MESSAGE_INVALID" });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    }
  });

  it("retains historical reasoning continuation when explicitly disabling thinking", async () => {
    const fetchFn = jest.fn().mockResolvedValue(completionResponse("OK"));
    const adapter = new DeepSeekLanguageModelAdapter(fetchFn, async () => undefined);
    await adapter.complete({
      providerId: "deepseek", modelId: "deepseek-v4-flash", apiKey: "test-key",
      messages: [
        { role: "assistant", content: "", reasoningContent: "historical continuation", toolCalls: [{ id: "call-1", name: "read", arguments: "{}" }] },
        { role: "tool", toolCallId: "call-1", content: "evidence" },
      ],
    });
    const body = JSON.parse(String(fetchFn.mock.calls[0][1].body));
    expect(body.thinking).toEqual({type: "disabled"});
    expect(body.messages[0].reasoning_content).toBe("historical continuation");
  });

  it("streams text deltas and returns the final usage snapshot", async () => {
    const body = [
      'data: {"id":"stream-1","model":"deepseek-test","choices":[{"delta":{"content":"第一段"},"finish_reason":null}]}',
      '',
      'data: {"id":"stream-1","model":"deepseek-test","choices":[{"delta":{"content":"回答"},"finish_reason":"stop"}]}',
      '',
      'data: {"id":"stream-1","model":"deepseek-test","choices":[],"usage":{"prompt_tokens":12,"completion_tokens":4,"total_tokens":16,"prompt_cache_hit_tokens":8,"prompt_cache_miss_tokens":4}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');
    const fetchFn = jest.fn().mockResolvedValue(new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }));
    const adapter = new DeepSeekLanguageModelAdapter(fetchFn, async () => undefined);
    const deltas: string[] = [];

    const completion = await adapter.streamText({
      providerId: "deepseek", modelId: "deepseek-test",
      apiKey: "never-store-this-key",
      messages: [{ role: "user", content: "呈现答案" }],
      temperature: 0.6,
      maxOutputTokens: 4_096,
      trace: { component: "ai-reading", taskId: "task-1", modelCallId: "answer-1" },
    }, (delta) => { deltas.push(delta); });

    expect(deltas).toEqual(["第一段", "回答"]);
    expect(completion).toMatchObject({
      id: "stream-1",
      message: { role: "assistant", content: "第一段回答" },
      usage: {
        promptTokens: 12,
        completionTokens: 4,
        totalTokens: 16,
        cacheReadInputTokens: 8,
        uncachedInputTokens: 4,
      },
      finishReason: "stop",
    });
    expect(JSON.parse(String(fetchFn.mock.calls[0][1]?.body))).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.6,
      max_tokens: 4_096,
    });
  });

  it("normalizes non-streaming cache usage without inventing cache-write tokens", async () => {
    const fetchFn = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "cache-1",
      providerId: "deepseek", modelId: "deepseek-test",
      choices: [{ finish_reason: "stop", message: { role: "assistant", content: "OK" } }],
      usage: {
        prompt_tokens: 20,
        completion_tokens: 2,
        total_tokens: 22,
        prompt_cache_hit_tokens: 16,
        prompt_cache_miss_tokens: 4,
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const adapter = new DeepSeekLanguageModelAdapter(fetchFn, async () => undefined);

    const completion = await adapter.complete({
      providerId: "deepseek", modelId: "deepseek-test",
      apiKey: "never-store-this-key",
      messages: [{ role: "user", content: "test" }],
    });

    expect(completion.usage).toEqual({
      promptTokens: 20,
      completionTokens: 2,
      totalTokens: 22,
      cacheReadInputTokens: 16,
      cacheWriteInputTokens: null,
      uncachedInputTokens: 4,
    });
  });

  it("retries one invalid HTTP 200 response within the original deadline", async () => {
    const fetchFn = jest.fn()
      .mockResolvedValueOnce(new Response("{\"choices\":[", {
        status: 200,
        headers: { "Content-Type": "application/json", "x-request-id": "bad-1" },
      }))
      .mockResolvedValueOnce(completionResponse("recovered"));
    const adapter = new DeepSeekLanguageModelAdapter(fetchFn, async () => undefined);

    const completion = await adapter.complete({
      providerId: "deepseek", modelId: "deepseek-test",
      apiKey: "never-store-this-key",
      messages: [{ role: "user", content: "test" }],
      timeoutMs: 10_000,
    });

    expect(completion.message.content).toBe("recovered");
    expect(completion.attempt).toBe(2);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("retries retryable stream failures before the first published delta", async () => {
    const fetchFn = jest.fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockRejectedValueOnce(new TypeError("temporary network failure"))
      .mockResolvedValueOnce(streamResponse("最终回答"));
    const sleep = jest.fn(async () => undefined);
    const adapter = new DeepSeekLanguageModelAdapter(fetchFn, sleep);
    const deltas: string[] = [];

    const completion = await adapter.streamText({
      providerId: "deepseek", modelId: "deepseek-test",
      apiKey: "never-store-this-key",
      messages: [{ role: "user", content: "呈现答案" }],
      timeoutMs: 10_000,
    }, (delta) => { deltas.push(delta); });

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(deltas).toEqual(["最终回答"]);
    expect(completion.attempt).toBe(3);
  });

  it("does not retry a stream after any delta has reached the caller", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          'data: {"id":"partial","choices":[{"delta":{"content":"半截"}}]}\n\n',
        ));
        setTimeout(() => controller.error(new TypeError("socket closed")), 0);
      },
    });
    const fetchFn = jest.fn().mockResolvedValue(new Response(body, { status: 200 }));
    const adapter = new DeepSeekLanguageModelAdapter(fetchFn, async () => undefined);
    const deltas: string[] = [];

    await expect(adapter.streamText({
      providerId: "deepseek", modelId: "deepseek-test",
      apiKey: "never-store-this-key",
      messages: [{ role: "user", content: "呈现答案" }],
    }, (delta) => { deltas.push(delta); })).rejects.toMatchObject({
      code: "DEEPSEEK_NETWORK_ERROR",
      attempt: 1,
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(deltas).toEqual(["半截"]);
  });

  it("honors Retry-After before retrying a rate-limited request", async () => {
    let now = 0;
    const fetchFn = jest.fn()
      .mockResolvedValueOnce(new Response("rate limited", {
        status: 429,
        headers: { "Retry-After": "2" },
      }))
      .mockResolvedValueOnce(completionResponse("OK"));
    const sleep = jest.fn(async (milliseconds: number) => { now += milliseconds; });
    const adapter = new DeepSeekLanguageModelAdapter(fetchFn, sleep, () => now);

    await adapter.complete({
      providerId: "deepseek", modelId: "deepseek-test",
      apiKey: "never-store-this-key",
      messages: [{ role: "user", content: "test" }],
      timeoutMs: 10_000,
    });

    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it("honors an HTTP-date Retry-After value", async () => {
    let now = Date.parse("2026-08-20T00:00:00.000Z");
    const fetchFn = jest.fn()
      .mockResolvedValueOnce(new Response("rate limited", {
        status: 429,
        headers: { "Retry-After": "Thu, 20 Aug 2026 00:00:03 GMT" },
      }))
      .mockResolvedValueOnce(completionResponse("OK"));
    const sleep = jest.fn(async (milliseconds: number) => { now += milliseconds; });
    const adapter = new DeepSeekLanguageModelAdapter(fetchFn, sleep, () => now);

    await adapter.complete({
      providerId: "deepseek", modelId: "deepseek-test",
      apiKey: "never-store-this-key",
      messages: [{ role: "user", content: "test" }],
      timeoutMs: 10_000,
    });

    expect(sleep).toHaveBeenCalledWith(3_000);
  });

  it("sends sampling and output limits for non-streaming requests", async () => {
    const fetchFn = jest.fn().mockResolvedValue(completionResponse("OK"));
    const adapter = new DeepSeekLanguageModelAdapter(fetchFn, async () => undefined);

    await adapter.complete({
      providerId: "deepseek", modelId: "deepseek-test",
      apiKey: "never-store-this-key",
      messages: [{ role: "user", content: "test" }],
      temperature: 0.2,
      maxOutputTokens: 2_048,
    });

    expect(JSON.parse(String(fetchFn.mock.calls[0][1]?.body))).toMatchObject({
      temperature: 0.2,
      max_tokens: 2_048,
    });
  });

  it("leaves model capability policy to the provider-neutral gateway", async () => {
    const fetchFn = jest.fn().mockResolvedValue(completionResponse("OK"));
    const adapter = new DeepSeekLanguageModelAdapter(fetchFn, async () => undefined);

    await expect(adapter.complete({
      providerId: "deepseek", modelId: "deepseek-reasoner",
      apiKey: "never-store-this-key",
      messages: [{ role: "user", content: "read" }],
      tools: [{
        type: "function",
        function: {
          name: "book_read",
          description: "Read",
          parameters: { type: "object" },
          strict: true,
        },
      }],
    })).resolves.toMatchObject({ message: { content: "OK" } });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("rejects null tool content before it reaches the upstream API", async () => {
    const fetchFn = jest.fn().mockResolvedValue(completionResponse("should not be called"));
    const adapter = new DeepSeekLanguageModelAdapter(fetchFn, async () => undefined);

    await expect(adapter.complete({
      providerId: "deepseek", modelId: "deepseek-test",
      apiKey: "never-store-this-key",
      messages: [{ role: "tool", toolCallId: "tool-1", content: null }] as any,
    })).rejects.toMatchObject({ code: "MODEL_MESSAGE_INVALID" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("records normalized requests and responses without persisting the API key", async () => {
    const debugLog = { write: jest.fn() };
    const fetchFn = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "response-1",
      providerId: "deepseek", modelId: "deepseek-test",
      choices: [{
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "tool-1", function: { name: "book_toc", arguments: "{}" } }],
        },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }), { status: 200 }));
    const adapter = new DeepSeekLanguageModelAdapter(fetchFn, async () => undefined, Date.now, debugLog as any);

    await adapter.complete({
      providerId: "deepseek", modelId: "deepseek-test",
      apiKey: "never-store-this-key",
      messages: [{ role: "user", content: "读取这本书" }],
      trace: { component: "ai-reading", taskId: "task-1", modelCallId: "model-1" },
    });

    expect(debugLog.write).toHaveBeenCalledWith(expect.objectContaining({
      event: "llm.request",
      trace: expect.objectContaining({ taskId: "task-1", modelCallId: "model-1" }),
      data: expect.objectContaining({ messageCount: 1, messageCharacters: 5 }),
      secrets: ["never-store-this-key"],
    }));
    expect(debugLog.write).toHaveBeenCalledWith(expect.objectContaining({
      event: "llm.response",
      data: expect.objectContaining({
        usage: expect.objectContaining({ promptTokens: 10, completionTokens: 5 }),
      }),
    }));
  });

  it("records normalized LLM errors with trace IDs and without response bodies", async () => {
    const debugLog = { write: jest.fn() };
    const fetchFn = jest.fn().mockResolvedValue(new Response("private upstream body", { status: 401 }));
    const adapter = new DeepSeekLanguageModelAdapter(
      fetchFn,
      async () => undefined,
      Date.now,
      debugLog as any,
    );

    await expect(adapter.complete({
      providerId: "deepseek", modelId: "deepseek-test",
      apiKey: "never-store-this-key",
      messages: [{ role: "user", content: "读取这本书" }],
      trace: { component: "ai-reading", taskId: "task-1", modelCallId: "model-2" },
    })).rejects.toMatchObject({ code: "DEEPSEEK_AUTH_FAILED" });

    expect(debugLog.write).toHaveBeenCalledWith(expect.objectContaining({
      event: "llm.error",
      trace: expect.objectContaining({ taskId: "task-1", modelCallId: "model-2" }),
      data: expect.objectContaining({
        name: "Error",
        message: "DeepSeek request failed with status 401",
        code: "DEEPSEEK_AUTH_FAILED",
        kind: "auth_failed",
        providerId: "deepseek",
        providerCode: "DEEPSEEK_AUTH_FAILED",
        retryable: false,
        status: 401,
        attempt: 1,
      }),
      secrets: ["never-store-this-key"],
    }));
    expect(JSON.stringify(debugLog.write.mock.calls)).not.toContain("private upstream body");
  });
});

function completionResponse(content: string): Response {
  return new Response(JSON.stringify({
    id: "response-1",
    providerId: "deepseek", modelId: "deepseek-test",
    choices: [{ finish_reason: "stop", message: { role: "assistant", content } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function streamResponse(content: string): Response {
  return new Response([
    `data: ${JSON.stringify({ id: "stream-retry", model: "deepseek-test", choices: [{ delta: { content }, finish_reason: "stop" }] })}`,
    "",
    "data: [DONE]",
    "",
  ].join("\n"), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}
