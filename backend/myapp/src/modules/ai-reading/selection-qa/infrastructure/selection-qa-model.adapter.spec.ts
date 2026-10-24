import {
  LanguageModelError,
  type LanguageModelPort,
  type ModelCapabilityCatalog,
  type ModelConfigPort,
  type TokenEstimatorCatalog,
} from "../../../../support/ai-model/public";
import type { QaModelInput } from "../application/selection-qa-runtime.port";
import { SelectionQaModelAdapter } from "./selection-qa-model.adapter";

function fixture() {
  const completion = {
    id: "response", model: "test-model", message: { role: "assistant" as const, content: null, toolCalls: [] },
    usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6 },
    finishReason: "stop", durationMs: 1, attempt: 1,
  };
  const model: LanguageModelPort = {
    complete: jest.fn(async () => completion),
    streamText: jest.fn(async (_input, onDelta) => { await onDelta("真实增量"); return completion; }),
  };
  const config = { provider: "test-provider", displayName: "Test", modelId: "test-model", hasApiKey: true, updatedAt: "version" };
  const configs = {
    getPublic: jest.fn(() => config),
    getCredential: jest.fn(() => ({ provider: "test-provider", modelId: "test-model", apiKey: "isolated-test-key" })),
  } as unknown as ModelConfigPort;
  const profile = { capabilities: { reasoning: false, tokenizerId: "test-tokenizer", contextWindowTokens: 64000, maxOutputTokens: 8192 } };
  const profiles = { assertCapability: jest.fn(() => profile), resolve: jest.fn(() => profile) } as unknown as ModelCapabilityCatalog;
  const tokenizers = { require: jest.fn(() => ({ count: () => 10 })) } as unknown as TokenEstimatorCatalog;
  const adapter = new SelectionQaModelAdapter(model, configs, profiles, tokenizers);
  const snapshot = adapter.snapshot(1);
  const input: QaModelInput = {
    turnId: "turn", messages: [{ role: "user", content: "测试问题" }],
    tools: [{ type: "function", function: { name: "test_tool", description: "Test", strict: true, parameters: { type: "object" } } }],
    maxOutputTokens: 200, signal: new AbortController().signal, timeoutMs: 10000,
  };
  return { adapter, model, configs, config, snapshot, input };
}

describe("selection QA provider attempt boundary", () => {
  it("allows exactly one provider attempt per reserved action or final model call", async () => {
    const h = fixture();
    await h.adapter.complete(1, h.snapshot, h.input);
    expect(h.model.complete).toHaveBeenCalledTimes(1);
    expect(h.model.complete).toHaveBeenCalledWith(expect.objectContaining({ maxAttempts: 1, timeoutMs: 10000, toolChoice: "required" }));
    const onDelta = jest.fn();
    await h.adapter.stream(1, h.snapshot, h.input, onDelta);
    expect(h.model.streamText).toHaveBeenCalledTimes(1);
    const request = (h.model.streamText as jest.Mock).mock.calls[0][0];
    expect(request.maxAttempts).toBe(1);
    expect(request).not.toHaveProperty("tools");
    expect(request).not.toHaveProperty("toolChoice");
    expect(onDelta).toHaveBeenCalledWith("真实增量");
  });

  it("propagates a retryable malformed response instead of silently spending another model call", async () => {
    const h = fixture();
    const error = new LanguageModelError("TEST_INVALID_RESPONSE", "invalid isolated response", true, 200, 1);
    h.model.complete = jest.fn(async () => { throw error; });
    await expect(h.adapter.complete(1, h.snapshot, h.input)).rejects.toBe(error);
    expect(h.model.complete).toHaveBeenCalledTimes(1);
  });

  it("rejects a changed model configuration before any provider call", async () => {
    const h = fixture();
    h.config.updatedAt = "changed-version";
    await expect(h.adapter.complete(1, h.snapshot, h.input)).rejects.toMatchObject({ code: "MODEL_CONFIG_CHANGED" });
    expect(h.model.complete).not.toHaveBeenCalled();
  });
});
