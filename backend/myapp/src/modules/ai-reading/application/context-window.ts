import type {
  ModelMessage,
  ModelToolDefinition,
  PromptPlan,
} from "./ports/language-model.port";
import type {
  ModelRuntimePort,
  ModelTokenEstimator,
} from "./ports/model-runtime.port";

const MAX_TOOL_OBSERVATION_BATCHES = 4;
const CHECKPOINT_PREFIX = "Structured checkpoint: ";
const MIN_CHECKPOINT_TOKENS = 128;
const MODEL_MESSAGE_OVERHEAD_TOKENS = 4;
const MAX_STRUCTURED_CHECKPOINT_CHARACTERS = 20_000;
const MAX_RETAINED_EVIDENCE_IDS = 48;

export interface ModelContextBudget {
  maxContextTokens: number;
  reservedOutputTokens: number;
  maxBookReadCharacters: number;
  minBookReadCharacters: number;
}

export interface ModelContextUsage {
  messageTokens: number;
  toolSchemaTokens: number;
  reservedOutputTokens: number;
  totalTokens: number;
  remainingInputTokens: number;
}

export const AI_READING_CONTEXT_BUDGET: ModelContextBudget = {
  // Deliberately below the provider context limit. Correctness must not rely on
  // prompt caching or on the largest context currently advertised upstream.
  maxContextTokens: 128_000,
  reservedOutputTokens: 16_384,
  maxBookReadCharacters: 50_000,
  minBookReadCharacters: 200,
};

export class AgentContextWindow {
  constructor(private readonly runtime?: ModelRuntimePort) {}

  usage(
    messages: ModelMessage[],
    tools: ModelToolDefinition[],
    providerId: string,
    modelId: string,
  ): ModelContextUsage {
    const context = this.context(providerId, modelId);
    return AgentContextWindow.usage(
      messages,
      tools,
      context.budget,
      context.estimator,
    );
  }

  shouldCompactPromptPlan(
    plan: PromptPlan,
    observationBatches: number,
    providerId: string,
    modelId: string,
  ): boolean {
    const context = this.context(providerId, modelId);
    return AgentContextWindow.shouldCompactPromptPlan(
      plan,
      observationBatches,
      context.budget,
      context.estimator,
    );
  }

  compactPromptPlan(
    plan: PromptPlan,
    checkpoint: Record<string, unknown>,
    providerId: string,
    modelId: string,
  ): PromptPlan {
    const context = this.context(providerId, modelId);
    return AgentContextWindow.compactPromptPlan(
      plan,
      checkpoint,
      context.budget,
      context.estimator,
    );
  }

  clampBookReadMaxChars(
    requestedCharacters: number | undefined,
    messages: ModelMessage[],
    tools: ModelToolDefinition[],
    providerId: string,
    modelId: string,
  ): number {
    const context = this.context(providerId, modelId);
    return AgentContextWindow.clampBookReadMaxChars(
      requestedCharacters,
      messages,
      tools,
      context.budget,
      context.estimator,
    );
  }

  private context(providerId: string, modelId: string): {
    estimator: ModelTokenEstimator;
    budget: ModelContextBudget;
  } {
    if (!this.runtime) throw new Error("MODEL_CONTEXT_DEPENDENCIES_UNAVAILABLE");
    const context = this.runtime.context(providerId, modelId);
    return {
      estimator: context.tokenizer,
      budget: {
        ...AI_READING_CONTEXT_BUDGET,
        maxContextTokens: Math.min(
          AI_READING_CONTEXT_BUDGET.maxContextTokens,
          context.contextWindowTokens,
        ),
        reservedOutputTokens: Math.min(
          AI_READING_CONTEXT_BUDGET.reservedOutputTokens,
          context.maxOutputTokens,
        ),
      },
    };
  }

  static shouldCompactPromptPlan(
    plan: PromptPlan,
    observationBatches: number,
    budget: ModelContextBudget = AI_READING_CONTEXT_BUDGET,
    estimator?: ModelTokenEstimator,
  ): boolean {
    return observationBatches >= MAX_TOOL_OBSERVATION_BATCHES
      || this.usage(promptPlanMessages(plan), plan.tools, budget, estimator).remainingInputTokens < 0;
  }

  static compactPromptPlan(
    plan: PromptPlan,
    checkpoint: Record<string, unknown>,
    budget: ModelContextBudget = AI_READING_CONTEXT_BUDGET,
    estimator?: ModelTokenEstimator,
  ): PromptPlan {
    const protectedTurn = latestProtectedTurn(plan.appendOnlyHistory, 0);
    const fixedTokens = estimateMessagesTokens([...plan.stablePrefix, ...protectedTurn, ...plan.dynamicTail], estimator)
      + estimateTokens(JSON.stringify(plan.tools), estimator);
    const availableCheckpointTokens = Math.max(
      MIN_CHECKPOINT_TOKENS,
      budget.maxContextTokens - budget.reservedOutputTokens - fixedTokens - estimateTokens(CHECKPOINT_PREFIX, estimator),
    );
    return {
      ...plan,
      stablePrefix: plan.stablePrefix.map(cloneMessage),
      appendOnlyHistory: [{ role: "user", content: `${CHECKPOINT_PREFIX}${fitCheckpoint(
        checkpoint,
        availableCheckpointTokens,
        estimator,
      )}` }, ...protectedTurn],
      dynamicTail: plan.dynamicTail.map(cloneMessage),
    };
  }
  static shouldCompact(
    messages: ModelMessage[],
    observationBatches: number,
    tools: ModelToolDefinition[] = [],
    budget: ModelContextBudget = AI_READING_CONTEXT_BUDGET,
    estimator?: ModelTokenEstimator,
  ): boolean {
    return observationBatches >= MAX_TOOL_OBSERVATION_BATCHES
      || this.usage(messages, tools, budget, estimator).remainingInputTokens < 0;
  }

  static usage(
    messages: ModelMessage[],
    tools: ModelToolDefinition[] = [],
    budget: ModelContextBudget = AI_READING_CONTEXT_BUDGET,
    estimator?: ModelTokenEstimator,
  ): ModelContextUsage {
    const messageTokens = estimateMessagesTokens(messages, estimator);
    const toolSchemaTokens = estimateTokens(JSON.stringify(tools), estimator);
    const inputTokens = messageTokens + toolSchemaTokens;
    return {
      messageTokens,
      toolSchemaTokens,
      reservedOutputTokens: budget.reservedOutputTokens,
      totalTokens: inputTokens + budget.reservedOutputTokens,
      remainingInputTokens: budget.maxContextTokens - budget.reservedOutputTokens - inputTokens,
    };
  }

  static clampBookReadMaxChars(
    requestedCharacters: number | undefined,
    messages: ModelMessage[],
    tools: ModelToolDefinition[],
    budget: ModelContextBudget = AI_READING_CONTEXT_BUDGET,
    estimator?: ModelTokenEstimator,
  ): number {
    const requested = Math.min(
      Math.max(requestedCharacters ?? 4_000, budget.minBookReadCharacters),
      budget.maxBookReadCharacters,
    );
    const remainingTokens = this.usage(messages, tools, budget, estimator).remainingInputTokens;
    // A projected book_read result carries continuation, boundary, and evidence
    // ranges in addition to text. One token per character is conservative for
    // CJK book bodies; the fixed reserve covers the JSON projection.
    const availableCharacters = Math.max(
      budget.minBookReadCharacters,
      remainingTokens - 4_096,
    );
    return Math.min(requested, availableCharacters);
  }

  static compact(
    messages: ModelMessage[],
    checkpoint: Record<string, unknown>,
    tools: ModelToolDefinition[] = [],
    budget: ModelContextBudget = AI_READING_CONTEXT_BUDGET,
    estimator?: ModelTokenEstimator,
  ): ModelMessage[] {
    const stable = messages.slice(0, 2).map(cloneMessage);
    const protectedTurn = latestProtectedTurn(messages, 2);
    const fixedTokens = estimateMessagesTokens([...stable, ...protectedTurn], estimator)
      + estimateTokens(JSON.stringify(tools), estimator);
    const availableCheckpointTokens = Math.max(
      MIN_CHECKPOINT_TOKENS,
      budget.maxContextTokens
        - budget.reservedOutputTokens
        - fixedTokens
        - estimateTokens(CHECKPOINT_PREFIX, estimator),
    );
    const checkpointJson = fitCheckpoint(checkpoint, availableCheckpointTokens, estimator);
    return [
      ...stable,
      {
        role: "user",
        content: `${CHECKPOINT_PREFIX}${checkpointJson}`,
      },
      ...protectedTurn,
    ];
  }
}

function latestProtectedTurn(messages: ModelMessage[], minimumIndex: number): ModelMessage[] {
  for (let index = messages.length - 1; index >= minimumIndex; index -= 1) {
    const message = messages[index];
    const toolCalls = message.role === "assistant" ? message.toolCalls ?? [] : [];
    if (toolCalls.length === 0) continue;
    const expected = new Set(toolCalls.map((call) => call.id));
    const responses = messages.slice(index + 1).filter((candidate) =>
      candidate.role === "tool" && candidate.toolCallId && expected.has(candidate.toolCallId));
    // A pending assistant tool-call turn is protected before execution. A
    // completed turn is protected until the following model response proves it
    // has been consumed. The orchestrator controls that timing.
    return [cloneMessage(message), ...responses.map(cloneMessage)];
  }
  return messages.slice(-2).map(cloneMessage);
}

export function promptPlanMessages(plan: PromptPlan): ModelMessage[] {
  return [...plan.stablePrefix, ...plan.appendOnlyHistory, ...plan.dynamicTail];
}

function fitCheckpoint(
  checkpoint: Record<string, unknown>,
  maxTokens: number,
  estimator?: ModelTokenEstimator,
): string {
  const sanitized = sanitize(checkpoint) as Record<string, unknown>;
  const explicitlyRetainedEvidenceIds = collectRetainedEvidenceIds(sanitized);
  let fitted = criticalCheckpoint(sanitized, explicitlyRetainedEvidenceIds);
  const retainedEvidenceIds = promoteChildSummaryEvidenceIds(
    fitted,
    explicitlyRetainedEvidenceIds,
  );
  let serialized = JSON.stringify(fitted);
  let truncated = false;

  while (
    estimateTokens(serialized, estimator) > maxTokens
    || serialized.length > MAX_STRUCTURED_CHECKPOINT_CHARACTERS
  ) {
    if (shrinkCheckpointString(fitted) || shrinkNonCriticalArray(fitted)) {
      truncated = true;
      fitted.truncated = true;
      fitted.retainedEvidenceIds = retainedEvidenceIds;
      serialized = JSON.stringify(fitted);
      continue;
    }
    throw new Error("CHECKPOINT_BUDGET_EXCEEDED");
  }

  if (truncated && fitted.truncated !== true) fitted.truncated = true;
  fitted.retainedEvidenceIds = retainedEvidenceIds;
  return JSON.stringify(fitted);
}

function criticalCheckpoint(
  checkpoint: Record<string, unknown>,
  retainedEvidenceIds: string[],
): Record<string, unknown> {
  return {
    rootGoal: shorten(checkpoint.rootGoal, 2_000),
    currentPlan: compactPlan(checkpoint.currentPlan),
    targetStartLocator: checkpoint.targetStartLocator ?? null,
    targetEndLocator: checkpoint.targetEndLocator ?? null,
    currentContinuation: checkpoint.currentContinuation ?? null,
    continuationPending: checkpoint.continuationPending === true,
    direction: checkpoint.direction === "backward" ? "backward" : "forward",
    coverage: compactCoverage(checkpoint.coverage),
    findings: compactFindings(checkpoint.findings),
    sectionDigests: compactSectionDigests(checkpoint.sectionDigests),
    openQuestions: compactStrings(checkpoint.openQuestions, 400).slice(0, 6),
    budget: checkpoint.budget ?? null,
    retainedEvidenceIds,
    ...(checkpoint.childSummaries === undefined
      ? {}
      : { childSummaries: compactChildSummaries(checkpoint.childSummaries) }),
    ...(checkpoint.instruction === undefined
      ? {}
      : { instruction: shorten(checkpoint.instruction, 300) }),
  };
}

function compactChildSummaries(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 6).map((item) => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const findings = Array.isArray(record.findings)
      ? record.findings.slice(0, 2).map((finding) => {
        const findingRecord = finding && typeof finding === "object"
          ? finding as Record<string, unknown>
          : {};
        return {
          statement: shorten(findingRecord.text ?? findingRecord.statement, 300),
          evidenceIds: compactEvidenceIds(findingRecord.evidenceIds, 2),
        };
      })
      : [];
    return {
      agentRunId: shorten(record.agentRunId, 80),
      goal: shorten(record.goal, 240),
      status: shorten(record.status, 40),
      summary: shorten(record.summary, 500),
      findings,
      evidenceIds: compactEvidenceIds(record.evidenceIds, 4),
      openQuestions: compactStrings(record.openQuestions, 240).slice(0, 2),
      ...(record.errorCode === undefined ? {} : { errorCode: shorten(record.errorCode, 80) }),
    };
  });
}

function promoteChildSummaryEvidenceIds(
  checkpoint: Record<string, unknown>,
  explicitlyRetainedEvidenceIds: string[],
): string[] {
  const summaries = Array.isArray(checkpoint.childSummaries)
    ? checkpoint.childSummaries.filter((item): item is Record<string, unknown> => (
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
    ))
    : [];
  const retained = [...explicitlyRetainedEvidenceIds];
  const retainedSet = new Set(retained);
  const candidates = summaries.map((summary) => unique([
    ...compactEvidenceIds(summary.evidenceIds, 4),
    ...(Array.isArray(summary.findings) ? summary.findings.flatMap((finding) => (
      finding && typeof finding === "object" && !Array.isArray(finding)
        ? compactEvidenceIds((finding as Record<string, unknown>).evidenceIds, 2)
        : []
    )) : []),
  ]));
  const selectedBySummary = summaries.map(() => new Set<string>());
  const maximumCandidateCount = Math.max(0, ...candidates.map((items) => items.length));
  let truncated = false;

  for (let offset = 0; offset < maximumCandidateCount; offset += 1) {
    for (let index = 0; index < candidates.length; index += 1) {
      const evidenceId = candidates[index][offset];
      if (!evidenceId) continue;
      if (retainedSet.has(evidenceId)) {
        selectedBySummary[index].add(evidenceId);
        continue;
      }
      if (retained.length >= MAX_RETAINED_EVIDENCE_IDS) {
        truncated = true;
        continue;
      }
      retained.push(evidenceId);
      retainedSet.add(evidenceId);
      selectedBySummary[index].add(evidenceId);
    }
  }

  summaries.forEach((summary, index) => {
    const selected = selectedBySummary[index];
    summary.evidenceIds = compactEvidenceIds(summary.evidenceIds, 4).filter((id) => selected.has(id));
    if (Array.isArray(summary.findings)) {
      summary.findings = summary.findings.map((finding) => {
        if (!finding || typeof finding !== "object" || Array.isArray(finding)) return finding;
        const findingRecord = finding as Record<string, unknown>;
        return {
          ...findingRecord,
          evidenceIds: compactEvidenceIds(findingRecord.evidenceIds, 2)
            .filter((id) => selected.has(id)),
        };
      }).filter((finding) => (
        finding && typeof finding === "object" && !Array.isArray(finding)
        && Array.isArray((finding as Record<string, unknown>).evidenceIds)
        && ((finding as Record<string, unknown>).evidenceIds as unknown[]).length > 0
      ));
    }
  });
  if (truncated) checkpoint.childEvidencePromotionTruncated = true;
  checkpoint.retainedEvidenceIds = retained;
  return retained;
}

function compactEvidenceIds(value: unknown, maxItems: number): string[] {
  return Array.isArray(value)
    ? unique(value.filter((item): item is string => typeof item === "string" && item.length > 0))
      .slice(0, maxItems)
    : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function collectRetainedEvidenceIds(value: Record<string, unknown>): string[] {
  const retained = Array.isArray(value.retainedEvidenceIds)
    ? [...new Set(value.retainedEvidenceIds.filter((item): item is string => (
      typeof item === "string" && item.length > 0
    )))]
    : [];
  if (retained.length > MAX_RETAINED_EVIDENCE_IDS) {
    throw new Error("CHECKPOINT_RETAINED_EVIDENCE_LIMIT_EXCEEDED");
  }
  return retained;
}

function shrinkCheckpointString(value: unknown): boolean {
  let selected: { owner: Record<string, unknown>; key: string; value: string; priority: number } | undefined;
  const walk = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== "object") return;
    for (const [key, item] of Object.entries(candidate)) {
      if (typeof item === "string" && item.length > 96 && key !== "evidenceId") {
        const priority = /quote|statement|summary|description|title|instruction/i.test(key) ? 0 : 1;
        if (!selected
          || priority < selected.priority
          || (priority === selected.priority && item.length > selected.value.length)) {
          selected = { owner: candidate as Record<string, unknown>, key, value: item, priority };
        }
      } else {
        walk(item);
      }
    }
  };
  walk(value);
  if (!selected) return false;
  selected.owner[selected.key] = `${selected.value.slice(0, Math.max(64, Math.floor(selected.value.length / 2)))}...[truncated]`;
  return true;
}

function shrinkNonCriticalArray(value: unknown): boolean {
  let selected: unknown[] | undefined;
  const walk = (candidate: unknown, key?: string): void => {
    if (Array.isArray(candidate)) {
      if (key !== "evidenceIds" && key !== "retainedEvidenceIds" && candidate.length > 1
        && (!selected || JSON.stringify(candidate).length > JSON.stringify(selected).length)) {
        selected = candidate;
      }
      for (const item of candidate) walk(item);
      return;
    }
    if (!candidate || typeof candidate !== "object") return;
    for (const [childKey, item] of Object.entries(candidate)) walk(item, childKey);
  };
  walk(value);
  if (!selected) return false;
  selected.splice(Math.ceil(selected.length / 2));
  return true;
}

function compactPlan(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).map((item) => {
    if (!item || typeof item !== "object") return shorten(item, 200);
    const record = item as Record<string, unknown>;
    return {
      id: record.id,
      title: shorten(record.title ?? record.description, 240),
      status: record.status,
    };
  });
}

function compactCoverage(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return {
    totalCharacters: record.totalCharacters,
    readCallCount: record.readCallCount ?? record.batchCount,
    segmentCount: record.segmentCount ?? record.underlyingReadCount,
    coveredSectionCount: record.coveredSectionCount,
    firstRange: compactRange(record.firstRange),
    latestRange: compactRange(record.latestRange),
    recentRanges: Array.isArray(record.recentRanges)
      ? record.recentRanges.slice(-6).map(compactRange)
      : [],
  };
}

function compactFindings(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).map((item) => {
    if (!item || typeof item !== "object") return shorten(item, 240);
    const record = item as Record<string, unknown>;
    return {
      statement: shorten(record.statement ?? record.summary ?? record.goal, 240),
      status: record.status,
      evidenceIds: Array.isArray(record.evidenceIds)
        ? record.evidenceIds.filter((id): id is string => typeof id === "string").slice(0, 4)
        : [],
      openQuestions: compactStrings(record.openQuestions, 240),
    };
  });
}

function compactSectionDigests(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 6).map((item) => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      sectionIndex: record.sectionIndex,
      start: record.start,
      end: record.end,
      digest: shorten(record.digest, 500),
      evidenceIds: Array.isArray(record.evidenceIds)
        ? record.evidenceIds.filter((id): id is string => typeof id === "string").slice(0, 4)
        : [],
    };
  });
}

function compactRange(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    sectionIndex: record.sectionIndex,
    start: record.start,
    end: record.end,
    chapterPath: shorten(record.chapterPath, 240),
  };
}

function compactStrings(value: unknown, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string")
    .map((item) => item.slice(0, maxLength));
}

function shorten(value: unknown, maxLength: number): unknown {
  return typeof value === "string" && value.length > maxLength
    ? `${value.slice(0, maxLength)}...[truncated]`
    : value;
}

function estimateMessagesTokens(messages: ModelMessage[], estimator?: ModelTokenEstimator): number {
  return messages.reduce((total, message) => total
    + MODEL_MESSAGE_OVERHEAD_TOKENS
    + estimateTokens(message.role, estimator)
    + estimateTokens(message.content ?? "", estimator)
    + estimateTokens(message.toolCallId ?? "", estimator)
    + (message.toolCalls ?? []).reduce((toolTotal, call) => toolTotal
      + estimateTokens(call.id, estimator)
      + estimateTokens(call.name, estimator)
      + estimateTokens(call.arguments, estimator), 0), 0);
}

export function estimateTokens(value: string, estimator?: ModelTokenEstimator): number {
  if (!value) return 0;
  if (estimator) return estimator.count(value);
  let asciiCharacters = 0;
  let nonAsciiTokens = 0;
  for (const character of value) {
    if (character.codePointAt(0)! <= 0x7f) asciiCharacters += 1;
    else nonAsciiTokens += 1;
  }
  return nonAsciiTokens + Math.ceil(asciiCharacters / 4);
}

function cloneMessage(message: ModelMessage): ModelMessage {
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content,
      toolCalls: message.toolCalls?.map((call) => ({ ...call })),
    };
  }
  if (message.role === "tool") {
    return { role: "tool", content: message.content, toolCallId: message.toolCallId };
  }
  return { role: message.role, content: message.content };
}

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[Truncated]";
  if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
  if (!value || typeof value !== "object") return typeof value === "string" ? value.slice(0, 8_000) : value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/reasoning_content|reasoningContent|chain.?of.?thought|systemPrompt/i.test(key)) continue;
    output[key] = sanitize(item, depth + 1);
  }
  return output;
}
