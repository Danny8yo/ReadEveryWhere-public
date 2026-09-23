import { LanguageModelGateway } from "./language-model.gateway";
import { ModelProfileRegistry, type ModelProfileContribution } from "./model-profile";
import { AutomaticPrefixPromptCachePolicy, PromptCachePolicyRegistry } from "./prompt-cache-policy";
import { ProviderRegistry } from "./provider-registry";
import type { ModelProvider } from "./ports/model-provider.port";
import { TokenEstimatorRegistry } from "./ports/token-estimator.port";

describe("LanguageModelGateway", () => {
  const profiles = (strictTools = true) => new ModelProfileRegistry([{
    providerId: "deepseek",
    resolve: (modelId) => ({
      providerId: "deepseek",
      modelId,
      capabilities: {
        tools: strictTools,
        strictTools,
        streaming: true,
        reasoning: !strictTools,
        reasoningWithTools: false,
        contextWindowTokens: 1_000_000,
        maxOutputTokens: 384_000,
        tokenizerId: "deepseek-v3-offline-2025-01-20",
        cachePolicyId: "automatic-prefix" as const,
      },
    }),
  } satisfies ModelProfileContribution]);

  it("routes by providerId/modelId, clamps use-level output and attaches cache diagnostics", async () => {
    const provider: ModelProvider = {
      providerId: "deepseek",
      complete: jest.fn(async (request) => ({
        id: "response-1",
        model: request.modelId,
        message: { role: "assistant" as const, content: "OK" },
        usage: { promptTokens: 10, completionTokens: 1, totalTokens: 11 },
        finishReason: "stop",
        durationMs: 5,
        attempt: 1,
      })),
    };
    const gateway = new LanguageModelGateway(
      new ProviderRegistry([provider]),
      profiles(),
      new PromptCachePolicyRegistry([new AutomaticPrefixPromptCachePolicy()]),
      new TokenEstimatorRegistry([{
        tokenizerId: "deepseek-v3-offline-2025-01-20",
        encode: (value) => Array.from(value, (character) => character.codePointAt(0)!),
        count: (value) => Array.from(value).length,
      }]),
    );
    const completion = await gateway.complete({
      providerId: "deepseek",
      modelId: "deepseek-v4-flash",
      apiKey: "secret",
      messages: [],
      modelUse: "connectionTest",
      promptPlan: {
        stablePrefix: [{ role: "system", content: "stable" }],
        appendOnlyHistory: [],
        dynamicTail: [{ role: "user", content: "dynamic" }],
        tools: [],
        toolStage: "connection-test",
      },
    });

    expect(provider.complete).toHaveBeenCalledWith(expect.objectContaining({
      providerId: "deepseek",
      modelId: "deepseek-v4-flash",
      maxOutputTokens: 4_096,
      messages: [{ role: "system", content: "stable" }, { role: "user", content: "dynamic" }],
    }));
    expect(completion.cacheDiagnostics).toMatchObject({
      cacheBoundaryReason: "initial_request",
      estimatedInputTokens: expect.any(Number),
    });
  });

  it("rejects unknown providers and unsupported Tool capabilities before transport", async () => {
    const gateway = new LanguageModelGateway(
      new ProviderRegistry([]),
      new ModelProfileRegistry([{
        providerId: "deepseek",
        resolve: (modelId) => profiles(false).resolve("deepseek", modelId),
      }]),
      new PromptCachePolicyRegistry([new AutomaticPrefixPromptCachePolicy()]),
      new TokenEstimatorRegistry([]),
    );
    const base = {
      apiKey: "secret",
      messages: [{ role: "user" as const, content: "test" }],
    };

    await expect(gateway.complete({ ...base, providerId: "unknown", modelId: "x" }))
      .rejects.toMatchObject({ kind: "capability_unsupported" });
    await expect(gateway.complete({
      ...base,
      providerId: "deepseek",
      modelId: "deepseek-reasoner",
      tools: [{
        type: "function",
        function: { name: "read", description: "read", parameters: {}, strict: true },
      }],
    })).rejects.toMatchObject({ kind: "capability_unsupported" });
  });
  it('applies min(request, selectionQa policy, profile) and forwards cancellation/attempts', async () => {
    const complete = jest.fn(async (_request: import("./ports/language-model.port").ModelCompletionRequest) => ({ id:'ok',model:'test',message:{role:'assistant' as const,content:'ok'},usage:{promptTokens:0,completionTokens:0,totalTokens:0},finishReason:'stop',durationMs:0,attempt:1 }));
    const gateway = new LanguageModelGateway(new ProviderRegistry([{providerId:'deepseek',complete,streamText:complete}]),profiles(),new PromptCachePolicyRegistry([]),new TokenEstimatorRegistry([]));
    const controller=new AbortController();
    const base={providerId:'deepseek',modelId:'test',apiKey:'key',messages:[],modelUse:'selectionQa' as const,signal:controller.signal,maxAttempts:1};
    await gateway.complete({...base,maxOutputTokens:2048});
    expect(complete).toHaveBeenLastCalledWith(expect.objectContaining({maxOutputTokens:2048,maxAttempts:1,signal:controller.signal}));
    await gateway.streamText({...base,maxOutputTokens:8000},()=>{});
    expect(complete.mock.calls[complete.mock.calls.length - 1][0]).toMatchObject({maxOutputTokens:8000});
    await gateway.complete(base);expect(complete).toHaveBeenLastCalledWith(expect.objectContaining({maxOutputTokens:8192}));
    const smaller = new ModelProfileRegistry([{providerId:'deepseek',resolve:modelId=>{const profile=profiles().resolve('deepseek',modelId);return {...profile,capabilities:{...profile.capabilities,maxOutputTokens:1024}}}}]);
    await new LanguageModelGateway(new ProviderRegistry([{providerId:'deepseek',complete}]),smaller,new PromptCachePolicyRegistry([]),new TokenEstimatorRegistry([])).complete({...base,maxOutputTokens:2048});
    expect(complete).toHaveBeenLastCalledWith(expect.objectContaining({maxOutputTokens:1024}));
    for(const maxOutputTokens of [0,NaN,1.5])await expect(gateway.complete({...base,maxOutputTokens})).rejects.toMatchObject({code:'MODEL_MESSAGE_INVALID'});
  });
  it('rejects cancellation before and immediately after preparation without contacting the provider', async () => {
    const complete=jest.fn(); const gateway=new LanguageModelGateway(new ProviderRegistry([{providerId:'deepseek',complete,streamText:complete}]),profiles(),new PromptCachePolicyRegistry([]),new TokenEstimatorRegistry([]));
    for(const stream of [false,true])for(const before of [false,true]){
      const controller=new AbortController();if(before)controller.abort();
      const input={providerId:'deepseek',modelId:'test',apiKey:'key',messages:[],signal:controller.signal};
      const pending=stream?gateway.streamText(input,()=>{}):gateway.complete(input);if(!before)controller.abort();
      await expect(pending).rejects.toMatchObject({code:'MODEL_CANCELLED',kind:'cancelled',retryable:false});
    }
    expect(complete).not.toHaveBeenCalled();
  });

});
