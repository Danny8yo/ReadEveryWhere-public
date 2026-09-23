import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "dotenv";

config({ path: [".env.local", ".env"] });

const require = createRequire(import.meta.url);
const { CryptoService } = require("../dist/platform/crypto/crypto.service.js");
const { DeepSeekLanguageModelAdapter } = require("../dist/integrations/deepseek/deepseek-language-model.adapter.js");
const { DeepSeekModelProfileContribution } = require("../dist/integrations/deepseek/deepseek-model-profile.contribution.js");
const { DeepSeekTokenEstimator } = require("../dist/integrations/deepseek/deepseek-token-estimator.js");
const { LanguageModelGateway } = require("../dist/support/ai-model/application/language-model.gateway.js");
const { ModelProfileRegistry } = require("../dist/support/ai-model/application/model-profile.js");
const { AutomaticPrefixPromptCachePolicy, PromptCachePolicyRegistry } = require("../dist/support/ai-model/application/prompt-cache-policy.js");
const { ProviderRegistry } = require("../dist/support/ai-model/application/provider-registry.js");
const { TokenEstimatorRegistry } = require("../dist/support/ai-model/application/ports/token-estimator.port.js");

const email = process.env.AI_REGRESSION_EMAIL;
if (!email) throw new Error("AI_REGRESSION_EMAIL is required");

const databasePath = resolve(process.env.SQLITE_PATH ?? "data/read-everywhere.sqlite");
const database = new DatabaseSync(databasePath);
const row = database.prepare(`SELECT c.provider,c.model_id,c.encrypted_api_key
  FROM ai_model_configs c JOIN users u ON u.id=c.user_id WHERE u.email=?`).get(email);
database.close();
if (!row?.encrypted_api_key) throw new Error("MODEL_CONFIG_NOT_FOUND");

const apiKey = new CryptoService().decrypt(String(row.encrypted_api_key));
const providerId = String(row.provider);
const modelId = String(row.model_id);
const estimator = new DeepSeekTokenEstimator();
const gateway = new LanguageModelGateway(
  new ProviderRegistry([new DeepSeekLanguageModelAdapter()]),
  new ModelProfileRegistry([new DeepSeekModelProfileContribution()]),
  new PromptCachePolicyRegistry([new AutomaticPrefixPromptCachePolicy()]),
  new TokenEstimatorRegistry([estimator]),
);

const stablePrefix = [
  { role: "system", content: "You are a cache probe. Reply with only OK." },
  { role: "user", content: `Stable synthetic prefix. ${"缓存前缀稳定内容。".repeat(800)}` },
];
const toolV1 = [{
  type: "function",
  function: {
    name: "probe_lookup",
    description: "Return one synthetic cache-probe lookup.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
    strict: true,
  },
}];
const toolV2 = [{
  ...toolV1[0],
  function: { ...toolV1[0].function, description: "Return one changed-stage synthetic lookup." },
}];

const cases = [
  probe("append", "warm", [], "tail-A", [], "no-tools"),
  probe("append", "append-tail", [{ role: "user", content: "tail-A" }], "tail-B", [], "no-tools"),
  probe("dynamic", "state-1", [], "budget=10;usage=0", [], "no-tools"),
  probe("dynamic", "state-2", [], "budget=9;usage=1", [], "no-tools"),
  probe("tools", "same-schema-1", [], "stage=lookup;budget=8", toolV1, "lookup"),
  probe("tools", "same-schema-2", [], "stage=lookup;budget=7", toolV1, "lookup"),
  probe("tools", "changed-schema", [], "stage=reading;budget=6", toolV2, "reading"),
];

const results = [];
for (const item of cases) {
  const completion = await gateway.complete({
    providerId,
    modelId,
    apiKey,
    temperature: 0,
    maxOutputTokens: 16,
    timeoutMs: 60_000,
    messages: [],
    promptPlan: item.plan,
    trace: { component: `cache-probe-${item.group}`, taskId: item.group, agentRunId: "root" },
  });
  const estimated = completion.cacheDiagnostics?.estimatedInputTokens ?? null;
  const actual = completion.usage.promptTokens;
  results.push({
    group: item.group,
    case: item.name,
    usage: completion.usage,
    lcpTokens: completion.cacheDiagnostics?.longestCommonPrefixTokens ?? null,
    estimatedInputTokens: estimated,
    estimatedErrorRatio: estimated === null || actual === 0 ? null : (estimated - actual) / actual,
    cacheBoundaryReason: completion.cacheDiagnostics?.cacheBoundaryReason ?? null,
    stablePrefixFingerprint: completion.cacheDiagnostics?.stablePrefixFingerprint ?? null,
    toolSchemaFingerprint: completion.cacheDiagnostics?.toolSchemaFingerprint ?? null,
    durationMs: completion.durationMs,
    attempt: completion.attempt,
    providerRequestIdPresent: Boolean(completion.providerRequestId),
  });
}

const totalPrompt = results.reduce((sum, item) => sum + item.usage.promptTokens, 0);
const totalHit = results.reduce((sum, item) => sum + (item.usage.cacheReadInputTokens ?? 0), 0);
const totalMiss = results.reduce((sum, item) => sum + (item.usage.uncachedInputTokens ?? 0), 0);
const report = {
  generatedAt: new Date().toISOString(),
  providerId,
  modelId,
  results,
  totals: {
    promptTokens: totalPrompt,
    cacheReadInputTokens: totalHit,
    uncachedInputTokens: totalMiss,
    hitRatio: totalPrompt > 0 ? totalHit / totalPrompt : null,
    missRatio: totalPrompt > 0 ? totalMiss / totalPrompt : null,
    calls: results.length,
  },
};
const outputPath = resolve(process.argv[2] ?? "data/deepseek-cache-probe.json");
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify(report)}\n`);

function probe(group, name, appendOnlyHistory, dynamicContent, tools, toolStage) {
  return {
    group,
    name,
    plan: {
      stablePrefix,
      appendOnlyHistory,
      dynamicTail: [{ role: "user", content: dynamicContent }],
      tools,
      toolStage,
    },
  };
}
