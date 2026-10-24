import { Global, Module } from "@nestjs/common";
import { RERANKER_SETTINGS, type RerankerSettings } from "../../support/ai-model/public";
import { DashScopeRerankerAdapter } from "./dashscope-reranker.adapter";

/** SELECTION_QA_RERANKER=off|dashscope; dashscope requires all three DASHSCOPE_RERANK_* variables. */
export function rerankerSettings(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch = fetch): RerankerSettings {
  const mode = env.SELECTION_QA_RERANKER || "off";
  if (mode === "off") return { enabled: false };
  if (mode !== "dashscope") throw new Error(`SELECTION_QA_RERANKER must be off or dashscope, got ${mode}`);
  const url = env.DASHSCOPE_RERANK_URL, model = env.DASHSCOPE_RERANK_MODEL, apiKey = env.DASHSCOPE_RERANK_API_KEY;
  if (!url || !model || !apiKey)
    throw new Error("SELECTION_QA_RERANKER=dashscope requires DASHSCOPE_RERANK_URL, DASHSCOPE_RERANK_MODEL and DASHSCOPE_RERANK_API_KEY");
  return { enabled: true, reranker: new DashScopeRerankerAdapter(fetchImpl, { url, model, apiKey }) };
}

@Global()
@Module({
  providers: [{ provide: RERANKER_SETTINGS, useFactory: () => rerankerSettings(process.env) }],
  exports: [RERANKER_SETTINGS],
})
export class DashScopeIntegrationModule {}
