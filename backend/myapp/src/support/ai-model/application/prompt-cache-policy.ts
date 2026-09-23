import { createHash } from "node:crypto";
import type {
  ModelCacheDiagnostics,
  ModelMessage,
  ModelToolDefinition,
} from "./ports/language-model.port";
import type { PromptCachePolicyId } from "./model-profile";
import type { TokenEstimator } from "./ports/token-estimator.port";

export interface PromptPlan {
  stablePrefix: ModelMessage[];
  appendOnlyHistory: ModelMessage[];
  dynamicTail: ModelMessage[];
  tools: ModelToolDefinition[];
  toolStage: string;
}

export interface PromptCacheProjection extends ModelCacheDiagnostics {
  messages: ModelMessage[];
  tools: ModelToolDefinition[];
  toolStage: string;
  providerOptions?: Record<string, unknown>;
  inputTokenIds?: number[];
}

export interface PromptCachePolicy {
  readonly id: PromptCachePolicyId;
  project(
    plan: PromptPlan,
    context?: { tokenizer?: Pick<TokenEstimator, "encode">; previous?: PromptCacheProjection },
  ): PromptCacheProjection;
}

export class AutomaticPrefixPromptCachePolicy implements PromptCachePolicy {
  readonly id = "automatic-prefix" as const;

  project(
    plan: PromptPlan,
    context: { tokenizer?: Pick<TokenEstimator, "encode">; previous?: PromptCacheProjection } = {},
  ): PromptCacheProjection {
    const messages = [...plan.stablePrefix, ...plan.appendOnlyHistory, ...plan.dynamicTail];
    const stablePrefixFingerprint = fingerprint(plan.stablePrefix);
    const toolSchemaFingerprint = fingerprint(plan.tools);
    const serializedInput = stableStringify({ messages, tools: plan.tools });
    const inputTokenIds = context.tokenizer?.encode(serializedInput);
    const previous = context.previous;
    const toolChanged = previous && (
      previous.toolStage !== plan.toolStage
      || previous.toolSchemaFingerprint !== toolSchemaFingerprint
    );
    const cacheBoundaryReason = !previous
      ? "initial_request"
      : toolChanged
        ? "tool_stage_changed"
        : previous.stablePrefixFingerprint !== stablePrefixFingerprint
          ? "stable_prefix_changed"
          : "prefix_continued";
    return {
      messages,
      tools: plan.tools,
      toolStage: plan.toolStage,
      stablePrefixFingerprint,
      toolSchemaFingerprint,
      cacheBoundaryReason,
      estimatedInputTokens: inputTokenIds?.length ?? null,
      longestCommonPrefixTokens: inputTokenIds && previous?.inputTokenIds
        ? longestCommonPrefix(inputTokenIds, previous.inputTokenIds)
        : null,
      ...(inputTokenIds ? { inputTokenIds } : {}),
    };
  }
}

export class PromptCachePolicyRegistry {
  private readonly policies: Map<PromptCachePolicyId, PromptCachePolicy>;

  constructor(policies: readonly PromptCachePolicy[]) {
    this.policies = new Map(policies.map((policy) => [policy.id, policy]));
  }

  require(id: PromptCachePolicyId): PromptCachePolicy {
    const policy = this.policies.get(id);
    if (!policy) throw new Error(`PROMPT_CACHE_POLICY_UNAVAILABLE:${id}`);
    return policy;
  }
}

function longestCommonPrefix(left: readonly number[], right: readonly number[]): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
