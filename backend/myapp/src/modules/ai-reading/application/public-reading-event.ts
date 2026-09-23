import type {
  BudgetUsage,
  PublicReadingEventKind,
  PublicReadingEventPayload,
  PublicReadingEventPayloadV2,
  ReadingEventType,
  ReadingPlanStep,
} from "../domain";
import { AiReadingDomainError } from "../domain";

export const MAX_PUBLIC_EVENT_PAYLOAD_BYTES = 32 * 1024;
const MAX_RESULT_ITEMS = 5;

type PublicPlanStep = {
  id: string;
  title: string;
  status: ReadingPlanStep["status"];
};

interface PublicPayloadInput {
  kind: PublicReadingEventKind;
  title: unknown;
  summary?: unknown;
  toolName?: unknown;
  detail: Record<string, unknown>;
}

interface ToolResultOptions {
  argumentsValue?: unknown;
  evidenceIds?: string[];
  durationMs?: number;
  readSource?: {
    text: string;
    segments: Array<{ textStart: number; textEnd: number; citation: Record<string, unknown> }>;
  };
}

interface BudgetPayloadInput {
  cause: "model_call" | "tool_call" | "delegation" | "recovery";
  delta: BudgetUsage & { delegatedAgents: number };
  callDurationMs: number;
  remaining: Record<string, number>;
  exhaustedBy: unknown[];
}

const EVENT_KIND: Record<ReadingEventType, PublicReadingEventKind> = {
  task_queued: "task",
  task_started: "task",
  task_resumed: "recovery",
  plan_updated: "plan",
  agent_started: "agent",
  agent_queued: "agent",
  agent_waiting_children: "agent",
  agent_resumed: "agent",
  agent_progress: "commentary",
  agent_completed: "agent",
  agent_failed: "agent",
  tool_started: "tool",
  tool_observation: "tool",
  evidence_recorded: "evidence",
  evidence_imported: "evidence",
  answer_started: "answer",
  answer_delta: "answer",
  answer_completed: "answer",
  budget_updated: "budget",
  recovery_attempted: "recovery",
  task_completed: "task",
  task_partial: "task",
  task_needs_input: "task",
  task_failed: "task",
  task_cancelled: "task",
};

const EVENT_TITLES: Record<ReadingEventType, string> = {
  task_queued: "任务已进入队列",
  task_started: "开始阅读",
  task_resumed: "任务已恢复",
  plan_updated: "更新计划",
  agent_started: "Agent 开始工作",
  agent_queued: "Agent 已排队",
  agent_waiting_children: "Agent 等待子节点",
  agent_resumed: "Agent 继续工作",
  agent_progress: "Agent 执行说明",
  agent_completed: "Agent 完成工作",
  agent_failed: "Agent 工作失败",
  tool_started: "开始使用阅读工具",
  tool_observation: "阅读工具返回结果",
  evidence_recorded: "记录书内证据",
  evidence_imported: "已导入历史证据",
  answer_started: "开始生成回答",
  answer_delta: "回答持续生成中",
  answer_completed: "回答已生成",
  budget_updated: "预算已更新",
  recovery_attempted: "执行恢复动作",
  task_completed: "阅读完成",
  task_partial: "预算结束，整理已有发现",
  task_needs_input: "需要补充信息",
  task_failed: "任务失败",
  task_cancelled: "任务已停止",
};

export function createTaskEventPayload(
  type: Extract<ReadingEventType, `task_${string}`>,
  value: {
    goal?: unknown;
    status?: unknown;
    reasonCode?: unknown;
    budgetTier?: unknown;
    budgetMode?: unknown;
    budgetPolicy?: unknown;
  } = {},
): PublicReadingEventPayloadV2 {
  const summary = value.goal ?? value.reasonCode ?? value.status;
  return finalize({
    kind: EVENT_KIND[type],
    title: EVENT_TITLES[type],
    summary,
    detail: compactRecord({
      status: cleanCode(value.status),
      goal: cleanText(value.goal, 500),
      reasonCode: cleanCode(value.reasonCode),
      budgetTier: cleanCode(value.budgetTier),
      budgetMode: cleanCode(value.budgetMode),
      budgetPolicy: projectBudgetPolicy(value.budgetPolicy),
    }),
  });
}

export function createPlanEventPayload(value: {
  before: ReadingPlanStep[];
  after: ReadingPlanStep[];
  nextAction?: unknown;
}): PublicReadingEventPayloadV2 {
  return finalize({
    kind: "plan",
    title: EVENT_TITLES.plan_updated,
    summary: value.nextAction ?? `${value.after.length} 个计划步骤`,
    toolName: "update_plan",
    detail: {
      before: projectPlan(value.before),
      after: projectPlan(value.after),
      nextAction: cleanText(value.nextAction, 500),
    },
  });
}

export function createAgentEventPayload(
  type: "agent_started" | "agent_queued" | "agent_waiting_children" | "agent_resumed" | "agent_completed" | "agent_failed",
  value: {
    role: "root" | "subagent";
    goal?: unknown;
    status: unknown;
    parentRunId?: unknown;
    findingCount?: unknown;
    evidenceIds?: unknown;
    errorCode?: unknown;
  },
): PublicReadingEventPayloadV2 {
  return finalize({
    kind: "agent",
    title: EVENT_TITLES[type],
    summary: value.goal ?? value.errorCode ?? value.status,
    detail: compactRecord({
      role: value.role,
      goal: cleanText(value.goal, 1_000),
      status: cleanCode(value.status),
      parentRunId: cleanIdentifier(value.parentRunId),
      findingCount: safeInteger(value.findingCount),
      evidenceIds: cleanStringArray(value.evidenceIds, 20, 128),
      errorCode: cleanCode(value.errorCode),
    }),
  });
}

export function createAgentProgressPayload(value: { text: unknown }): PublicReadingEventPayloadV2 {
  const text = cleanText(value.text, 1_200);
  return finalize({
    kind: "commentary",
    title: EVENT_TITLES.agent_progress,
    summary: text,
    detail: {
      phase: "completed",
      text,
    },
  });
}

export function createToolStartedPayload(
  toolNameValue: unknown,
  argumentsValue: unknown,
): PublicReadingEventPayloadV2 {
  const toolName = cleanText(toolNameValue, 80) || "unknown_tool";
  return finalize({
    kind: "tool",
    title: `调用 ${toolName}`,
    summary: toolPurpose(toolName, argumentsValue),
    toolName,
    detail: {
      phase: "started",
      purpose: toolPurpose(toolName, argumentsValue),
      arguments: projectToolArguments(toolName, argumentsValue),
    },
  });
}

export function createToolObservationPayload(
  toolNameValue: unknown,
  output: unknown,
  options: ToolResultOptions = {},
): PublicReadingEventPayloadV2 {
  const toolName = cleanText(toolNameValue, 80) || "unknown_tool";
  const result = projectToolResult(toolName, output, options);
  const summary = summarizePublicToolResult(toolName, result);
  return finalize({
    kind: "tool",
    title: `${toolName} 已完成`,
    summary,
    toolName,
    detail: compactRecord({
      phase: "completed",
      purpose: toolPurpose(toolName, options.argumentsValue),
      arguments: projectToolArguments(toolName, options.argumentsValue),
      result,
      evidenceIds: cleanStringArray(options.evidenceIds, 20, 128),
      durationMs: safeNonNegativeInteger(options.durationMs),
    }),
  });
}

export function createToolFailedPayload(
  toolNameValue: unknown,
  argumentsValue: unknown,
  value: { errorCode: unknown; retryable: unknown; recoveryAction?: unknown; durationMs?: unknown },
): PublicReadingEventPayloadV2 {
  const toolName = cleanText(toolNameValue, 80) || "unknown_tool";
  const errorCode = cleanCode(value.errorCode) ?? "TOOL_EXECUTION_FAILED";
  return finalize({
    kind: "tool",
    title: `${toolName} 调用失败`,
    summary: errorCode,
    toolName,
    detail: compactRecord({
      phase: "failed",
      purpose: toolPurpose(toolName, argumentsValue),
      arguments: projectToolArguments(toolName, argumentsValue),
      errorCode,
      retryable: value.retryable === true,
      recoveryAction: cleanText(value.recoveryAction, 500),
      durationMs: safeNonNegativeInteger(value.durationMs),
    }),
  });
}

export function createEvidenceEventPayload(value: {
  quote: unknown;
  chapterPath?: unknown;
  citation?: unknown;
}): PublicReadingEventPayloadV2 {
  const quote = cleanText(value.quote, 600);
  return finalize({
    kind: "evidence",
    title: EVENT_TITLES.evidence_recorded,
    summary: quote,
    detail: compactRecord({
      quote,
      chapterPath: cleanText(value.chapterPath, 500),
      citation: projectCitation(value.citation),
    }),
  });
}

export function createEvidenceImportedEventPayload(value: {
  evidenceIds: unknown;
  importedCount: unknown;
}): PublicReadingEventPayloadV2 {
  const evidenceIds = cleanStringArray(value.evidenceIds, 20, 128);
  return finalize({
    kind: "evidence",
    title: EVENT_TITLES.evidence_imported,
    summary: `已核验并导入 ${evidenceIds.length} 条历史证据`,
    detail: {
      provenanceKind: "conversation_import",
      importedCount: safeNonNegativeInteger(value.importedCount) ?? evidenceIds.length,
      evidenceIds,
    },
  });
}

export function createAnswerStartedPayload(value: {
  answerId: unknown;
  mode: unknown;
}): PublicReadingEventPayloadV2 {
  return finalize({
    kind: "answer",
    title: EVENT_TITLES.answer_started,
    summary: value.mode === "fallback" ? "正在整理已核验结果" : "正在流式生成最终回答",
    detail: {
      phase: "started",
      answerId: cleanIdentifier(value.answerId) ?? "answer",
      mode: cleanEnum(value.mode, ["model", "fallback"]) ?? "model",
    },
  });
}

export function createAnswerDeltaPayload(value: {
  answerId: unknown;
  offset: unknown;
  delta: unknown;
}): PublicReadingEventPayloadV2 {
  return finalize({
    kind: "answer",
    title: EVENT_TITLES.answer_delta,
    detail: {
      phase: "streaming",
      answerId: cleanIdentifier(value.answerId) ?? "answer",
      offset: safeNonNegativeInteger(value.offset) ?? 0,
      delta: cleanText(value.delta, 2_000),
    },
  });
}

export function createAnswerCompletedPayload(value: {
  answerId: unknown;
  mode: unknown;
  text: unknown;
  evidenceIds?: unknown;
}): PublicReadingEventPayloadV2 {
  const text = cleanText(value.text, 8_000);
  return finalize({
    kind: "answer",
    title: EVENT_TITLES.answer_completed,
    summary: "最终回答已完成",
    detail: {
      phase: "completed",
      answerId: cleanIdentifier(value.answerId) ?? "answer",
      mode: cleanEnum(value.mode, ["model", "fallback"]) ?? "model",
      text,
      characterCount: text.length,
      evidenceIds: cleanStringArray(value.evidenceIds, 20, 128),
    },
  });
}

export function createBudgetEventPayload(value: BudgetPayloadInput): PublicReadingEventPayloadV2 {
  const remaining = projectBudgetCounters(value.remaining);
  return finalize({
    kind: "budget",
    title: EVENT_TITLES.budget_updated,
    summary: budgetSummary(value.delta),
    detail: {
      cause: value.cause,
      delta: {
        modelTurns: safeNonNegativeInteger(value.delta.modelTurns) ?? 0,
        toolCalls: safeNonNegativeInteger(value.delta.toolCalls) ?? 0,
        readCharacters: safeNonNegativeInteger(value.delta.readCharacters) ?? 0,
        delegatedAgents: safeNonNegativeInteger(value.delta.delegatedAgents) ?? 0,
      },
      callDurationMs: safeNonNegativeInteger(value.callDurationMs) ?? 0,
      remaining,
      exhaustedBy: cleanStringArray(value.exhaustedBy, 6, 40),
    },
  });
}

export function createRecoveryEventPayload(value: {
  toolName?: unknown;
  errorCode: unknown;
  retryable: unknown;
  recoveryAction?: unknown;
  attempt?: unknown;
  summary?: unknown;
  relatedAgentRunId?: unknown;
}): PublicReadingEventPayloadV2 {
  const toolName = cleanText(value.toolName, 80);
  const errorCode = cleanCode(value.errorCode) ?? "RECOVERY_REQUIRED";
  const recoveryAction = cleanText(value.recoveryAction, 500);
  return finalize({
    kind: "recovery",
    title: EVENT_TITLES.recovery_attempted,
    summary: value.summary ?? recoveryAction ?? errorCode,
    toolName,
    detail: compactRecord({
      errorCode,
      retryable: value.retryable === true,
      recoveryAction,
      attempt: safeNonNegativeInteger(value.attempt),
      relatedAgentRunId: cleanIdentifier(value.relatedAgentRunId),
    }),
  });
}

export function createResumeEventPayload(message: unknown): PublicReadingEventPayloadV2 {
  const recoveryAction = cleanText(message, 500) || "继续执行未完成任务";
  return finalize({
    kind: "recovery",
    title: EVENT_TITLES.task_resumed,
    summary: recoveryAction,
    detail: {
      errorCode: "TASK_RESUMED_AFTER_RESTART",
      retryable: true,
      recoveryAction,
      attempt: 1,
    },
  });
}

export function assertPublicReadingEventPayloadV2(
  value: unknown,
): asserts value is PublicReadingEventPayloadV2 {
  if (!isRecord(value)) {
    throw new AiReadingDomainError("READING_EVENT_PUBLIC_PAYLOAD_INVALID", "public payload must be an object");
  }
  if (
    value.schemaVersion !== 2
    || !isKind(value.kind)
    || typeof value.title !== "string"
    || value.title.length === 0
    || value.title.length > 80
    || (value.summary !== undefined && (typeof value.summary !== "string" || value.summary.length > 280))
    || (value.toolName !== undefined && (typeof value.toolName !== "string" || value.toolName.length > 80))
    || (value.truncated !== undefined && value.truncated !== true)
    || !isRecord(value.detail)
    || !hasOnlyKeys(value, ["schemaVersion", "kind", "title", "summary", "toolName", "truncated", "detail"])
  ) {
    throw new AiReadingDomainError("READING_EVENT_PUBLIC_PAYLOAD_INVALID", "public payload does not match v2");
  }
  if (value.kind === "tool" && !value.toolName) {
    invalidPublicPayload("tool payload requires toolName");
  }
  assertNoSensitiveKeys(value);
  assertDetail(value.kind, value.detail, value.toolName);
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_PUBLIC_EVENT_PAYLOAD_BYTES) {
    throw new AiReadingDomainError("READING_EVENT_PUBLIC_PAYLOAD_TOO_LARGE", "public payload exceeds 32 KiB");
  }
}

export function toPublicReadingEventPayload(
  type: ReadingEventType,
  storedValue: unknown,
): PublicReadingEventPayload {
  const value = asRecord(storedValue);
  if (value.schemaVersion === 2) {
    assertPublicReadingEventPayloadV2(value);
    return value;
  }
  const toolName = cleanText(value.toolName ?? value.tool, 80);
  const summary = firstText(value, [
    "summary",
    "observationSummary",
    "nextAction",
    "goal",
    "errorCode",
    "reason",
  ], 280);
  return {
    schemaVersion: 1,
    legacy: true,
    kind: EVENT_KIND[type],
    title: toolName && (type === "tool_started" || type === "tool_observation")
      ? `${type === "tool_started" ? "调用" : "完成"} ${toolName}`
      : EVENT_TITLES[type],
    ...(summary ? { summary } : {}),
    ...(toolName ? { toolName } : {}),
    detail: { unavailable: true },
  };
}

export function projectToolArguments(toolName: string, value: unknown): Record<string, unknown> {
  const args = asRecord(value);
  switch (toolName) {
    case "book_toc":
      return compactRecord({ cursorUsed: Boolean(args.cursor), limit: safeInteger(args.limit) });
    case "book_toc_tree":
      return {};
    case "book_toc_navigation":
      return { nodeIds: cleanStringArray(args.nodeIds, 20, 128) };
    case "book_read_from_toc":
      return compactRecord({
        nodeIds: args.nodeIds === undefined ? undefined : cleanStringArray(args.nodeIds, 20, 128),
        nodeCount: Array.isArray(args.nodeIds) ? args.nodeIds.length : undefined,
        cursorUsed: Boolean(args.cursor),
      });
    case "book_read": {
      const locator = asRecord(args.locator);
      const position = asRecord(locator.position);
      const structure = asRecord(locator.structure);
      return compactRecord({
        direction: cleanEnum(args.direction, ["forward", "backward", "around"]) ?? "forward",
        maxChars: safeInteger(args.maxChars) ?? 4_000,
        position: compactRecord({
          sectionIndex: safeInteger(position.sectionIndex),
          start: safeInteger(position.start),
          end: safeInteger(position.end),
        }),
        chapter: cleanText(structure.path ?? structure.label, 240),
      });
    }
    case "book_search_text":
      return compactRecord({
        query: cleanText(args.query, 300),
        cursorUsed: Boolean(args.cursor),
        limit: safeInteger(args.limit),
      });
    case "book_list_annotations":
      return compactRecord({
        cursorUsed: Boolean(args.cursor),
        limit: safeInteger(args.limit),
        hasNote: typeof args.hasNote === "boolean" ? args.hasNote : undefined,
        types: cleanStringArray(args.types, 3, 40),
      });
    case "update_plan":
      return compactRecord({
        stepCount: Array.isArray(args.steps) ? Math.min(args.steps.length, 20) : 0,
        nextAction: cleanText(args.nextAction, 500),
      });
    case "delegate_reading":
      return {
        subtasks: arrayOfRecords(args.subtasks, 3).map((item) => compactRecord({
          id: cleanIdentifier(item.id),
          goal: cleanText(item.goal, 1_000),
        })),
      };
    case "complete_task":
      return completionCounts(args, false);
    case "complete_subtask":
      return completionCounts(args, true);
    default:
      return {};
  }
}

export function projectCitation(value: unknown): Record<string, unknown> | undefined {
  const citation = asRecord(value);
  const locator = asRecord(citation.locator);
  const position = asRecord(locator.position);
  if (!Number.isSafeInteger(position.sectionIndex) || !Number.isSafeInteger(position.start) || !Number.isSafeInteger(position.end)) {
    return undefined;
  }
  const textQuote = asRecord(locator.textQuote);
  const structure = asRecord(locator.structure);
  const readerAnchor = asRecord(locator.readerAnchor);
  const epubcfi = cleanText(readerAnchor.epubcfi, 2_049);
  return compactRecord({
    bookId: safeInteger(citation.bookId),
    bookTitle: cleanText(citation.bookTitle, 300),
    authors: cleanStringArray(citation.authors, 10, 120),
    chapterPath: cleanText(citation.chapterPath, 500),
    annotationId: cleanIdentifier(citation.annotationId),
    locator: compactRecord({
      version: locator.version === 1 ? 1 : undefined,
      position: {
        kind: "epub_text",
        sectionIndex: position.sectionIndex,
        start: position.start,
        end: position.end,
      },
      textQuote: compactRecord({
        exact: cleanText(textQuote.exact, 1_500),
        prefix: cleanText(textQuote.prefix, 128),
        suffix: cleanText(textQuote.suffix, 128),
      }),
      structure: compactRecord({
        tocNodeId: cleanText(structure.tocNodeId, 128),
        href: cleanText(structure.href, 1_024),
        fragment: cleanText(structure.fragment, 256),
        label: cleanText(structure.label, 300),
        path: cleanText(structure.path, 500),
      }),
      readerAnchor: epubcfi && epubcfi.length <= 2_048 ? { epubcfi } : undefined,
    }),
  });
}

function projectToolResult(
  toolName: string,
  outputValue: unknown,
  options: ToolResultOptions,
): Record<string, unknown> {
  const output = asRecord(outputValue);
  if (toolName === "book_read" || toolName === "book_read_from_toc") {
    const text = options.readSource?.text ?? (typeof output.text === "string" ? output.text : "");
    const segments = options.readSource?.segments ?? arrayOfRecords(output.segments, 100).map((segment) => ({
      textStart: safeInteger(segment.textStart) ?? 0,
      textEnd: safeInteger(segment.textEnd) ?? 0,
      citation: asRecord(segment.citation),
    }));
    const continuation = asRecord(output.continuation);
    const boundary = asRecord(output.boundary);
    const citations = segments.slice(0, MAX_RESULT_ITEMS)
      .map((segment) => projectCitation(segment.citation))
      .filter((citation): citation is Record<string, unknown> => citation !== undefined);
    if (toolName === "book_read_from_toc") {
      const coverage = asRecord(output.coverage);
      return {
        characterCount: text.length, segmentCount: segments.length, citations,
        unitCount: Array.isArray(output.units) ? output.units.length : 0,
        unavailableCount: safeInteger(coverage.unavailableUnits) ?? 0,
        coverage: { complete: coverage.complete === true, nextAvailable: Boolean(continuation.next),
          returnedChars: safeInteger(coverage.returnedChars) ?? 0, pendingChars: safeInteger(coverage.pendingChars) ?? 0,
          unavailableChars: safeInteger(coverage.unavailableChars) ?? 0 },
        unavailable: arrayOfRecords(output.unavailable, MAX_RESULT_ITEMS).map((unit) => ({
          nodeId: cleanText(unit.nodeId, 256), label: cleanText(unit.label, 240),
          kind: cleanEnum(unit.kind, ["subtree", "own"]), reason: cleanEnum(unit.reason, ["TOC_NODE_TOO_LARGE", "TOC_NODE_NOT_READABLE"]),
          characterCount: safeInteger(unit.normalizedCharCount) ?? 0,
        })),
      };
    }
    return compactRecord({
      characterCount: text.length,
      excerpt: cleanText(text, 800),
      segmentCount: segments.length,
      citations,
      boundaries: {
        previousAvailable: Boolean(output.previousLocator ?? continuation.previous),
        nextAvailable: Boolean(output.nextLocator ?? continuation.next),
        reachedSectionStart: output.reachedSectionStart === true || boundary.sectionStart === true,
        reachedSectionEnd: output.reachedSectionEnd === true || boundary.sectionEnd === true,
        reachedBookStart: output.reachedBookStart === true || boundary.bookStart === true,
        reachedBookEnd: output.reachedBookEnd === true || boundary.bookEnd === true,
      },
    });
  }

  if (["book_toc", "book_toc_tree", "book_toc_navigation"].includes(toolName)) {
    const items = flattenTocItems(output.entries).slice(0, MAX_RESULT_ITEMS).map((item) => compactRecord({
      nodeId: cleanText(item.nodeId, 128),
      label: cleanText(item.label, 120),
      path: cleanText(item.path, 240),
      level: safeInteger(item.level),
      ownCharCount: safeInteger(item.ownCharCount),
      subtreeCharCount: safeInteger(item.subtreeCharCount),
      hasChildren: item.hasChildren === true || (Array.isArray(item.children) && item.children.length > 0),
    }));
    return pageResult(items, output, flattenTocItems(output.entries).length);
  }

  if (toolName === "book_search_text") {
    const hits = arrayOfRecords(output.hits, MAX_RESULT_ITEMS);
    return pageResult(hits.map((item) => compactRecord({
      matchedText: cleanText(item.matchedText, 120),
      snippet: cleanText(item.snippet, 320),
      chapterPath: cleanText(item.chapterPath, 240),
      citation: projectCitation(item.citation),
    })), output, Array.isArray(output.hits) ? output.hits.length : 0);
  }

  if (toolName === "book_list_annotations") {
    const items = arrayOfRecords(output.items, MAX_RESULT_ITEMS);
    return pageResult(items.map((item) => {
      const location = asRecord(item.location);
      return compactRecord({
        annotationId: cleanIdentifier(item.annotationId),
        type: cleanCode(item.type),
        selectedText: cleanText(item.selectedText, 240),
        note: cleanText(item.note, 240),
        chapterLabel: cleanText(item.chapterLabel, 120),
        locationQuality: cleanCode(location.quality),
        citation: projectCitation(item.citation),
      });
    }), output, Array.isArray(output.items) ? output.items.length : 0);
  }

  if (toolName === "delegate_reading") {
    const subtasks = arrayOfRecords(asRecord(options.argumentsValue).subtasks, 3);
    const results = arrayOfRecords(output.results, 3);
    return {
      delegates: subtasks.map((subtask, index) => compactRecord({
        subtaskId: cleanIdentifier(subtask.id),
        goal: cleanText(subtask.goal, 1_000),
        agentRunId: cleanIdentifier(results[index]?.agentRunId),
        status: cleanCode(results[index]?.status) ?? "started",
        evidenceCount: cleanStringArray(results[index]?.evidenceIds, 20, 128).length,
        errorCode: cleanCode(results[index]?.errorCode),
      })),
    };
  }

  if (toolName === "update_plan") {
    return { stepCount: Array.isArray(output.plan) ? Math.min(output.plan.length, 20) : 0 };
  }

  if (toolName === "complete_task" || toolName === "complete_subtask") {
    return { accepted: true, ...completionCounts(asRecord(options.argumentsValue), toolName === "complete_subtask") };
  }

  return { completed: true };
}

function finalize(input: PublicPayloadInput): PublicReadingEventPayloadV2 {
  const base: Record<string, unknown> = {
    schemaVersion: 2,
    kind: input.kind,
    title: cleanText(input.title, 80) || "事件已更新",
    ...(cleanText(input.summary, 280) ? { summary: cleanText(input.summary, 280) } : {}),
    ...(cleanText(input.toolName, 80) ? { toolName: cleanText(input.toolName, 80) } : {}),
    detail: input.detail,
  };
  if (payloadBytes(base) <= MAX_PUBLIC_EVENT_PAYLOAD_BYTES) {
    assertPublicReadingEventPayloadV2(base);
    return base;
  }

  const reduced = reduceOversizedPayload(base);
  if (payloadBytes(reduced) <= MAX_PUBLIC_EVENT_PAYLOAD_BYTES) {
    assertPublicReadingEventPayloadV2(reduced);
    return reduced;
  }

  const fallback: Record<string, unknown> = {
    ...base,
    truncated: true,
    detail: { truncated: true },
  };
  assertPublicReadingEventPayloadV2(fallback);
  return fallback;
}

function projectPlan(steps: ReadingPlanStep[]): PublicPlanStep[] {
  return steps.slice(0, 20).map((step) => ({
    id: cleanText(step.id, 80),
    title: cleanText(step.description, 500),
    status: step.status,
  }));
}

function projectBudgetPolicy(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;
  const keys = [
    "maxModelTurns",
    "maxToolCalls",
    "maxReadCharacters",
    "maxDurationMs",
    "maxDelegatedAgents",
    "maxConcurrentAgents",
  ];
  const result: Record<string, number> = {};
  for (const key of keys) {
    const item = safeNonNegativeInteger(value[key]);
    if (item !== undefined) result[key] = item;
  }
  return Object.keys(result).length ? result : undefined;
}

function projectBudgetCounters(value: Record<string, number>): Record<string, number> {
  return Object.fromEntries([
    "modelTurns",
    "toolCalls",
    "readCharacters",
    "durationMs",
    "delegatedAgents",
    "concurrentAgents",
  ].map((key) => [key, safeNonNegativeInteger(value[key]) ?? 0]));
}

function toolPurpose(toolName: string, value: unknown): string {
  const args = asRecord(value);
  const purposes: Record<string, () => string> = {
    book_toc: () => "分页浏览目录，了解全书结构",
    book_toc_tree: () => "查看完整目录树，识别章节层级",
    book_toc_navigation: () => `把 ${Array.isArray(args.nodeIds) ? args.nodeIds.length : 0} 个目录节点解析为阅读位置`,
    book_read_from_toc: () => args.cursor ? "继续读取下一批完整目录单元" : `按结构读取 ${Array.isArray(args.nodeIds) ? args.nodeIds.length : 0} 个目录节点并记录未读缺口`,
    book_read: () => "从指定位置限量读取正文并形成可引用证据",
    book_search_text: () => `在书内检索“${cleanText(args.query, 120)}”`,
    book_list_annotations: () => "扫描当前书籍的用户批注",
    update_plan: () => "更新可见计划和下一步动作",
    delegate_reading: () => `并行分配 ${Array.isArray(args.subtasks) ? args.subtasks.length : 0} 个独立阅读子任务`,
    conversation_import_evidence: () => "核验并导入同一会话的历史证据",
    update_reading_state: () => "保存受限阅读状态，供下一轮继续",
    request_clarification: () => "请求用户补充缺失的阅读范围",
    complete_turn: () => "提交结构化结果并生成本轮最终回答",
    complete_subtask: () => "提交子任务的结构化发现与证据",
    complete_task: () => "提交最终的结构化阅读结果",
  };
  return cleanText((purposes[toolName] ?? (() => "执行受限的阅读动作"))(), 300);
}

function summarizePublicToolResult(toolName: string, result: Record<string, unknown>): string {
  if (toolName === "book_read_from_toc") {
    const coverage = asRecord(result.coverage);
    return `读取 ${safeInteger(result.characterCount) ?? 0} 个字符；${safeInteger(result.unavailableCount) ?? 0} 个单元不可完整读取；${coverage.complete === true ? "所选范围已读完" : "所选范围尚未完整覆盖"}`;
  }
  if (toolName === "book_read" || toolName === "book_read_from_toc") {
    return `读取 ${safeInteger(result.characterCount) ?? 0} 个字符并形成可引用摘录`;
  }
  if (typeof result.returnedCount === "number") return `${toolName} 本页返回 ${result.returnedCount} 项`;
  if (toolName === "delegate_reading") return `已处理 ${Array.isArray(result.delegates) ? result.delegates.length : 0} 个子任务`;
  return `${toolName} 已完成`;
}

function pageResult(items: Record<string, unknown>[], output: Record<string, unknown>, returnedCount: number) {
  return {
    returnedCount,
    items,
    pagination: {
      hasMore: output.hasMore === true,
      nextCursorAvailable: typeof output.nextCursor === "string" && output.nextCursor.length > 0,
      truncatedItems: returnedCount > items.length,
    },
  };
}

function completionCounts(args: Record<string, unknown>, subtask: boolean): Record<string, number> {
  if (subtask) {
    return {
      findingCount: arrayLength(args.findings),
      openQuestionCount: arrayLength(args.openQuestions),
      evidenceReferenceCount: countEvidenceReferences(args.findings),
    };
  }
  return {
    bookFindingCount: arrayLength(args.bookFindings),
    inferenceCount: arrayLength(args.inferences),
    modelKnowledgeCount: arrayLength(args.modelKnowledge),
    openQuestionCount: arrayLength(args.openQuestions),
    limitationCount: arrayLength(args.limitations),
    evidenceReferenceCount: countEvidenceReferences([
      ...(Array.isArray(args.bookFindings) ? args.bookFindings : []),
      ...(Array.isArray(args.inferences) ? args.inferences : []),
    ]),
  };
}

function countEvidenceReferences(value: unknown): number {
  return arrayOfRecords(value, 80).reduce((total, item) => total + arrayLength(item.evidenceIds), 0);
}

function flattenTocItems(value: unknown): Record<string, unknown>[] {
  const flattened: Record<string, unknown>[] = [];
  const visit = (items: unknown, depth = 0) => {
    if (depth > 20 || !Array.isArray(items)) return;
    for (const itemValue of items) {
      if (!isRecord(itemValue)) continue;
      flattened.push({ ...itemValue, level: itemValue.level ?? depth });
      visit(itemValue.children, depth + 1);
    }
  };
  visit(value);
  return flattened;
}

function budgetSummary(delta: BudgetPayloadInput["delta"]): string {
  const parts: string[] = [];
  if (delta.modelTurns) parts.push(`模型轮次 +${delta.modelTurns}`);
  if (delta.toolCalls) parts.push(`工具调用 +${delta.toolCalls}`);
  if (delta.readCharacters) parts.push(`阅读字符 +${delta.readCharacters}`);
  if (delta.delegatedAgents) parts.push(`子 Agent +${delta.delegatedAgents}`);
  return parts.join("，") || "预算快照已更新";
}

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  const withoutControls = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "");
  const redacted = withoutControls
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/giu, "Bearer [Redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/giu, "[Redacted]")
    .replace(/\b(api[ _-]?key|authorization|cookie|token|secret|password|reasoning_content|reasoningContent|system[ _-]?prompt)\s*[:=]\s*[^\s,;]+/giu, "$1=[Redacted]");
  return redacted.trim().slice(0, maxLength);
}

function cleanCode(value: unknown): string | undefined {
  const cleaned = cleanText(value, 80);
  return cleaned || undefined;
}

function cleanIdentifier(value: unknown): string | undefined {
  const cleaned = cleanText(value, 128);
  return cleaned || undefined;
}

function cleanStringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems)
    .map((item) => cleanText(item, maxLength))
    .filter(Boolean);
}

function firstText(value: Record<string, unknown>, keys: string[], maxLength: number): string {
  for (const key of keys) {
    const text = cleanText(value[key], maxLength);
    if (text) return text;
  }
  return "";
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => (
    item !== undefined
    && item !== ""
    && !(Array.isArray(item) && item.length === 0)
    && !(isRecord(item) && Object.keys(item).length === 0)
  )));
}

function asRecord(value: unknown): Record<string, any> {
  return isRecord(value) ? value : {};
}

function arrayOfRecords(value: unknown, maxItems: number): Record<string, any>[] {
  return Array.isArray(value) ? value.filter(isRecord).slice(0, maxItems) : [];
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function safeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) ? value as number : undefined;
}

function safeNonNegativeInteger(value: unknown): number | undefined {
  const integer = safeInteger(value);
  return integer !== undefined && integer >= 0 ? integer : undefined;
}

function cleanEnum<T extends string>(value: unknown, values: readonly T[]): T | undefined {
  return typeof value === "string" && values.includes(value as T) ? value as T : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertDetail(
  kind: PublicReadingEventKind,
  detail: Record<string, unknown>,
  toolName?: unknown,
): void {
  if (detail.truncated === true && hasOnlyKeys(detail, ["truncated"])) return;

  switch (kind) {
    case "task":
      assertTaskDetail(detail);
      return;
    case "plan":
      assertPlanDetail(detail);
      return;
    case "agent":
      assertAgentDetail(detail);
      return;
    case "commentary":
      assertCommentaryDetail(detail);
      return;
    case "tool":
      assertToolDetail(detail, String(toolName));
      return;
    case "evidence":
      assertEvidenceDetail(detail);
      return;
    case "answer":
      assertAnswerDetail(detail);
      return;
    case "budget":
      assertBudgetDetail(detail);
      return;
    case "recovery":
      assertRecoveryDetail(detail);
  }
}

function assertTaskDetail(detail: Record<string, unknown>): void {
  assertOnlyKeys(detail, ["status", "goal", "reasonCode", "budgetTier", "budgetMode", "budgetPolicy"]);
  optionalString(detail, "status", 80);
  optionalString(detail, "goal", 500);
  optionalString(detail, "reasonCode", 80);
  optionalString(detail, "budgetTier", 80);
  optionalString(detail, "budgetMode", 80);
  if (detail.budgetPolicy !== undefined) {
    const policy = requireRecord(detail.budgetPolicy, "budgetPolicy");
    const keys = [
      "maxModelTurns",
      "maxToolCalls",
      "maxReadCharacters",
      "maxDurationMs",
      "maxDelegatedAgents",
      "maxConcurrentAgents",
    ];
    assertOnlyKeys(policy, keys);
    for (const key of keys) optionalNonNegativeInteger(policy, key);
  }
}

function assertAnswerDetail(detail: Record<string, unknown>): void {
  assertOnlyKeys(detail, ["phase", "answerId", "mode", "offset", "delta", "text", "characterCount", "evidenceIds"]);
  if (!["started", "streaming", "completed"].includes(String(detail.phase))) {
    invalidPublicPayload("answer phase is invalid");
  }
  requiredString(detail, "answerId", 128);
  if (detail.mode !== undefined && !["model", "fallback"].includes(String(detail.mode))) {
    invalidPublicPayload("answer mode is invalid");
  }
  if (detail.phase === "streaming") {
    requiredNonNegativeInteger(detail, "offset");
    requiredString(detail, "delta", 2_000);
  }
  if (detail.phase === "completed") {
    requiredString(detail, "text", 8_000);
    requiredNonNegativeInteger(detail, "characterCount");
    optionalStringArray(detail, "evidenceIds", 20, 128);
  }
}

function assertPlanDetail(detail: Record<string, unknown>): void {
  assertOnlyKeys(detail, ["before", "after", "nextAction"]);
  assertPlanSteps(detail.before, "before");
  assertPlanSteps(detail.after, "after");
  optionalString(detail, "nextAction", 500);
}

function assertPlanSteps(value: unknown, field: string): void {
  if (!Array.isArray(value) || value.length > 20) invalidPublicPayload(`${field} must be an array of at most 20 steps`);
  for (const stepValue of value) {
    const step = requireRecord(stepValue, field);
    assertOnlyKeys(step, ["id", "title", "status"]);
    requiredString(step, "id", 80);
    requiredString(step, "title", 500);
    if (!["pending", "in_progress", "completed", "failed"].includes(String(step.status))) {
      invalidPublicPayload(`${field}.status is invalid`);
    }
  }
}

function assertAgentDetail(detail: Record<string, unknown>): void {
  assertOnlyKeys(detail, ["role", "goal", "status", "parentRunId", "findingCount", "evidenceIds", "errorCode"]);
  if (!["root", "subagent"].includes(String(detail.role))) invalidPublicPayload("agent role is invalid");
  requiredString(detail, "status", 80);
  optionalString(detail, "goal", 1_000);
  optionalString(detail, "parentRunId", 128);
  optionalNonNegativeInteger(detail, "findingCount");
  optionalStringArray(detail, "evidenceIds", 20, 128);
  optionalString(detail, "errorCode", 80);
}

function assertCommentaryDetail(detail: Record<string, unknown>): void {
  assertOnlyKeys(detail, ["phase", "text"]);
  if (detail.phase !== "completed") invalidPublicPayload("commentary phase is invalid");
  requiredString(detail, "text", 1_200);
}

function assertToolDetail(detail: Record<string, unknown>, toolName: string): void {
  assertOnlyKeys(detail, [
    "phase",
    "purpose",
    "arguments",
    "result",
    "evidenceIds",
    "durationMs",
    "errorCode",
    "retryable",
    "recoveryAction",
  ]);
  if (!["started", "completed", "failed"].includes(String(detail.phase))) {
    invalidPublicPayload("tool phase is invalid");
  }
  requiredString(detail, "purpose", 300);
  optionalNonNegativeInteger(detail, "durationMs");
  optionalStringArray(detail, "evidenceIds", 20, 128);
  optionalString(detail, "errorCode", 80);
  optionalBoolean(detail, "retryable");
  optionalString(detail, "recoveryAction", 500);

  if (detail.phase === "started" && !isRecord(detail.arguments)) {
    invalidPublicPayload("started tool payload requires arguments");
  }
  if (detail.phase === "completed" && !isRecord(detail.result)) {
    invalidPublicPayload("completed tool payload requires result");
  }
  if (detail.phase === "failed") {
    requiredString(detail, "errorCode", 80);
    if (typeof detail.retryable !== "boolean") invalidPublicPayload("failed tool payload requires retryable");
  }
  if (detail.arguments !== undefined) assertToolArguments(toolName, requireRecord(detail.arguments, "arguments"));
  if (detail.result !== undefined) assertToolResult(toolName, requireRecord(detail.result, "result"));
}

function assertToolArguments(toolName: string, value: Record<string, unknown>): void {
  switch (toolName) {
    case "book_toc":
      assertOnlyKeys(value, ["cursorUsed", "limit"]);
      optionalBoolean(value, "cursorUsed");
      optionalNonNegativeInteger(value, "limit");
      return;
    case "book_toc_tree":
      assertOnlyKeys(value, []);
      return;
    case "book_toc_navigation":
      assertOnlyKeys(value, ["nodeIds"]);
      optionalStringArray(value, "nodeIds", 20, 128);
      return;
    case "book_read_from_toc":
      assertOnlyKeys(value, ["nodeIds", "nodeCount", "cursorUsed"]);
      optionalStringArray(value, "nodeIds", 20, 128);
      optionalNonNegativeInteger(value, "nodeCount");
      optionalBoolean(value, "cursorUsed");
      return;
    case "book_read": {
      assertOnlyKeys(value, ["direction", "maxChars", "position", "chapter"]);
      if (value.direction !== undefined && !["forward", "backward", "around"].includes(String(value.direction))) {
        invalidPublicPayload("book_read direction is invalid");
      }
      optionalNonNegativeInteger(value, "maxChars");
      optionalString(value, "chapter", 240);
      if (value.position !== undefined) {
        const position = requireRecord(value.position, "position");
        assertOnlyKeys(position, ["sectionIndex", "start", "end"]);
        for (const key of ["sectionIndex", "start", "end"]) optionalNonNegativeInteger(position, key);
      }
      return;
    }
    case "book_search_text":
      assertOnlyKeys(value, ["query", "cursorUsed", "limit"]);
      optionalString(value, "query", 300);
      optionalBoolean(value, "cursorUsed");
      optionalNonNegativeInteger(value, "limit");
      return;
    case "book_list_annotations":
      assertOnlyKeys(value, ["cursorUsed", "limit", "hasNote", "types"]);
      optionalBoolean(value, "cursorUsed");
      optionalNonNegativeInteger(value, "limit");
      optionalBoolean(value, "hasNote");
      optionalStringArray(value, "types", 3, 40);
      return;
    case "update_plan":
      assertOnlyKeys(value, ["stepCount", "nextAction"]);
      optionalNonNegativeInteger(value, "stepCount");
      optionalString(value, "nextAction", 500);
      return;
    case "delegate_reading": {
      assertOnlyKeys(value, ["subtasks"]);
      if (!Array.isArray(value.subtasks) || value.subtasks.length > 3) invalidPublicPayload("delegate subtasks are invalid");
      for (const itemValue of value.subtasks) {
        const item = requireRecord(itemValue, "subtask");
        assertOnlyKeys(item, ["id", "goal", "deliverable", "contextEvidenceCount"]);
        optionalString(item, "id", 128);
        requiredString(item, "goal", 1_000);
        optionalString(item, "deliverable", 1_000);
        optionalNonNegativeInteger(item, "contextEvidenceCount");
      }
      return;
    }
    case "complete_task":
      assertCompletionCounts(value, false, false);
      return;
    case "complete_subtask":
      assertCompletionCounts(value, true, false);
      return;
    default:
      assertOnlyKeys(value, []);
  }
}

function assertToolResult(toolName: string, value: Record<string, unknown>): void {
  if (toolName === "book_read_from_toc") {
    assertOnlyKeys(value, ["characterCount", "segmentCount", "citations", "unitCount", "unavailableCount", "coverage", "unavailable"]);
    for (const key of ["characterCount", "segmentCount", "unitCount", "unavailableCount"]) requiredNonNegativeInteger(value, key);
    if (!Array.isArray(value.citations) || value.citations.length > MAX_RESULT_ITEMS) invalidPublicPayload("citations are invalid");
    for (const citation of value.citations as unknown[]) assertCitation(requireRecord(citation, "citation"));
    const coverage = requireRecord(value.coverage, "coverage");
    assertOnlyKeys(coverage, ["complete", "nextAvailable", "returnedChars", "pendingChars", "unavailableChars"]);
    for (const key of ["complete", "nextAvailable"]) optionalBoolean(coverage, key);
    for (const key of ["returnedChars", "pendingChars", "unavailableChars"]) requiredNonNegativeInteger(coverage, key);
    if (!Array.isArray(value.unavailable) || value.unavailable.length > MAX_RESULT_ITEMS) invalidPublicPayload("unavailable units are invalid");
    for (const item of value.unavailable as unknown[]) {
      const unit = requireRecord(item, "unavailable unit");
      assertOnlyKeys(unit, ["nodeId", "label", "kind", "reason", "characterCount"]);
      optionalString(unit, "nodeId", 256);
      optionalString(unit, "label", 240);
      if (!["own", "subtree"].includes(String(unit.kind)) || !["TOC_NODE_TOO_LARGE", "TOC_NODE_NOT_READABLE"].includes(String(unit.reason))) invalidPublicPayload("invalid unavailable unit");
      requiredNonNegativeInteger(unit, "characterCount");
    }
    return;
  }
  switch (toolName) {
    case "book_read":
    {
      assertOnlyKeys(value, ["characterCount", "excerpt", "segmentCount", "citations", "boundaries"]);
      requiredNonNegativeInteger(value, "characterCount");
      optionalString(value, "excerpt", 800);
      optionalNonNegativeInteger(value, "segmentCount");
      if (value.citations !== undefined) {
        if (!Array.isArray(value.citations) || value.citations.length > MAX_RESULT_ITEMS) {
          invalidPublicPayload("citations are invalid");
        }
        for (const citation of value.citations) assertCitation(requireRecord(citation, "citation"));
      }
      const boundaries = requireRecord(value.boundaries, "boundaries");
      const keys = [
        "previousAvailable",
        "nextAvailable",
        "reachedSectionStart",
        "reachedSectionEnd",
        "reachedBookStart",
        "reachedBookEnd",
      ];
      assertOnlyKeys(boundaries, keys);
      for (const key of keys) {
        if (typeof boundaries[key] !== "boolean") invalidPublicPayload(`boundaries.${key} must be boolean`);
      }
      return;
    }
    case "book_toc":
    case "book_toc_tree":
    case "book_toc_navigation":
      assertPageResult(value, (item) => {
        assertOnlyKeys(item, ["nodeId", "label", "path", "level", "ownCharCount", "subtreeCharCount", "hasChildren"]);
        optionalString(item, "nodeId", 128);
        optionalString(item, "label", 120);
        optionalString(item, "path", 240);
        optionalNonNegativeInteger(item, "level");
        optionalNonNegativeInteger(item, "ownCharCount");
        optionalNonNegativeInteger(item, "subtreeCharCount");
        optionalBoolean(item, "hasChildren");
      });
      return;
    case "book_search_text":
      assertPageResult(value, (item) => {
        assertOnlyKeys(item, ["matchedText", "snippet", "chapterPath", "citation"]);
        optionalString(item, "matchedText", 120);
        optionalString(item, "snippet", 320);
        optionalString(item, "chapterPath", 240);
        if (item.citation !== undefined) assertCitation(requireRecord(item.citation, "citation"));
      });
      return;
    case "book_list_annotations":
      assertPageResult(value, (item) => {
        assertOnlyKeys(item, ["annotationId", "type", "selectedText", "note", "chapterLabel", "locationQuality", "citation"]);
        optionalString(item, "annotationId", 128);
        optionalString(item, "type", 80);
        optionalString(item, "selectedText", 240);
        optionalString(item, "note", 240);
        optionalString(item, "chapterLabel", 120);
        optionalString(item, "locationQuality", 80);
        if (item.citation !== undefined) assertCitation(requireRecord(item.citation, "citation"));
      });
      return;
    case "delegate_reading": {
      assertOnlyKeys(value, ["delegates"]);
      if (!Array.isArray(value.delegates) || value.delegates.length > 3) invalidPublicPayload("delegate results are invalid");
      for (const itemValue of value.delegates) {
        const item = requireRecord(itemValue, "delegate");
        assertOnlyKeys(item, ["subtaskId", "goal", "agentRunId", "status", "evidenceCount", "errorCode"]);
        optionalString(item, "subtaskId", 128);
        optionalString(item, "goal", 1_000);
        optionalString(item, "agentRunId", 128);
        optionalString(item, "status", 80);
        optionalNonNegativeInteger(item, "evidenceCount");
        optionalString(item, "errorCode", 80);
      }
      return;
    }
    case "update_plan":
      assertOnlyKeys(value, ["stepCount"]);
      optionalNonNegativeInteger(value, "stepCount");
      return;
    case "complete_task":
      assertCompletionCounts(value, false, true);
      return;
    case "complete_subtask":
      assertCompletionCounts(value, true, true);
      return;
    default:
      assertOnlyKeys(value, ["completed"]);
      if (value.completed !== true) invalidPublicPayload("unknown tool result must only report completion");
  }
}

function assertCompletionCounts(value: Record<string, unknown>, subtask: boolean, result: boolean): void {
  const keys = subtask
    ? ["findingCount", "openQuestionCount", "evidenceReferenceCount"]
    : ["bookFindingCount", "inferenceCount", "modelKnowledgeCount", "openQuestionCount", "limitationCount", "evidenceReferenceCount"];
  assertOnlyKeys(value, result ? ["accepted", ...keys] : keys);
  if (result && value.accepted !== true) invalidPublicPayload("completion result must be accepted");
  for (const key of keys) optionalNonNegativeInteger(value, key);
}

function assertPageResult(
  value: Record<string, unknown>,
  assertItem: (item: Record<string, unknown>) => void,
): void {
  assertOnlyKeys(value, ["returnedCount", "items", "pagination"]);
  requiredNonNegativeInteger(value, "returnedCount");
  if (!Array.isArray(value.items) || value.items.length > MAX_RESULT_ITEMS) invalidPublicPayload("result items exceed the public limit");
  for (const itemValue of value.items) assertItem(requireRecord(itemValue, "result item"));
  const pagination = requireRecord(value.pagination, "pagination");
  assertOnlyKeys(pagination, ["hasMore", "nextCursorAvailable", "truncatedItems"]);
  for (const key of ["hasMore", "nextCursorAvailable", "truncatedItems"]) {
    if (typeof pagination[key] !== "boolean") invalidPublicPayload(`pagination.${key} must be boolean`);
  }
}

function assertEvidenceDetail(detail: Record<string, unknown>): void {
  if (detail.provenanceKind === "conversation_import") {
    assertOnlyKeys(detail, ["provenanceKind", "importedCount", "evidenceIds"]);
    requiredNonNegativeInteger(detail, "importedCount");
    optionalStringArray(detail, "evidenceIds", 20, 128);
    return;
  }
  assertOnlyKeys(detail, ["quote", "chapterPath", "citation"]);
  optionalString(detail, "quote", 600);
  optionalString(detail, "chapterPath", 500);
  if (detail.citation !== undefined) assertCitation(requireRecord(detail.citation, "citation"));
}

function assertCitation(citation: Record<string, unknown>): void {
  assertOnlyKeys(citation, ["bookId", "bookTitle", "authors", "chapterPath", "annotationId", "locator"]);
  optionalNonNegativeInteger(citation, "bookId");
  optionalString(citation, "bookTitle", 300);
  optionalStringArray(citation, "authors", 10, 120);
  optionalString(citation, "chapterPath", 500);
  optionalString(citation, "annotationId", 128);
  const locator = requireRecord(citation.locator, "citation.locator");
  assertOnlyKeys(locator, ["version", "position", "textQuote", "structure", "readerAnchor"]);
  if (locator.version !== undefined && locator.version !== 1) invalidPublicPayload("citation locator version is invalid");
  const position = requireRecord(locator.position, "citation.position");
  assertOnlyKeys(position, ["kind", "sectionIndex", "start", "end"]);
  if (position.kind !== "epub_text") invalidPublicPayload("citation position kind is invalid");
  for (const key of ["sectionIndex", "start", "end"]) requiredNonNegativeInteger(position, key);

  if (locator.textQuote !== undefined) {
    const quote = requireRecord(locator.textQuote, "textQuote");
    assertOnlyKeys(quote, ["exact", "prefix", "suffix"]);
    optionalString(quote, "exact", 1_500);
    optionalString(quote, "prefix", 128);
    optionalString(quote, "suffix", 128);
  }
  if (locator.structure !== undefined) {
    const structure = requireRecord(locator.structure, "structure");
    assertOnlyKeys(structure, ["tocNodeId", "href", "fragment", "label", "path"]);
    optionalString(structure, "tocNodeId", 128);
    optionalString(structure, "href", 1_024);
    optionalString(structure, "fragment", 256);
    optionalString(structure, "label", 300);
    optionalString(structure, "path", 500);
  }
  if (locator.readerAnchor !== undefined) {
    const anchor = requireRecord(locator.readerAnchor, "readerAnchor");
    assertOnlyKeys(anchor, ["epubcfi"]);
    requiredString(anchor, "epubcfi", 2_048);
  }
}

function assertBudgetDetail(detail: Record<string, unknown>): void {
  assertOnlyKeys(detail, ["cause", "delta", "callDurationMs", "remaining", "exhaustedBy"]);
  if (!["model_call", "tool_call", "delegation", "recovery"].includes(String(detail.cause))) {
    invalidPublicPayload("budget cause is invalid");
  }
  const delta = requireRecord(detail.delta, "budget delta");
  const deltaKeys = ["modelTurns", "toolCalls", "readCharacters", "delegatedAgents"];
  assertOnlyKeys(delta, deltaKeys);
  for (const key of deltaKeys) requiredNonNegativeInteger(delta, key);
  requiredNonNegativeInteger(detail, "callDurationMs");
  const remaining = requireRecord(detail.remaining, "budget remaining");
  const remainingKeys = ["modelTurns", "toolCalls", "readCharacters", "durationMs", "delegatedAgents", "concurrentAgents"];
  assertOnlyKeys(remaining, remainingKeys);
  for (const key of remainingKeys) requiredNonNegativeInteger(remaining, key);
  optionalStringArray(detail, "exhaustedBy", 6, 40, true);
}

function assertRecoveryDetail(detail: Record<string, unknown>): void {
  assertOnlyKeys(detail, ["errorCode", "retryable", "recoveryAction", "attempt", "relatedAgentRunId"]);
  requiredString(detail, "errorCode", 80);
  if (typeof detail.retryable !== "boolean") invalidPublicPayload("recovery retryable must be boolean");
  optionalString(detail, "recoveryAction", 500);
  optionalNonNegativeInteger(detail, "attempt");
  optionalString(detail, "relatedAgentRunId", 128);
}

function reduceOversizedPayload(value: Record<string, unknown>): Record<string, unknown> {
  const reduced = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  reduced.truncated = true;
  const detail = asRecord(reduced.detail);
  const result = asRecord(detail.result);
  const items = Array.isArray(result.items) ? result.items : undefined;
  while (items?.length && payloadBytes(reduced) > MAX_PUBLIC_EVENT_PAYLOAD_BYTES) {
    items.pop();
    const pagination = asRecord(result.pagination);
    if (Object.keys(pagination).length) pagination.truncatedItems = true;
  }
  if (typeof result.excerpt === "string") {
    for (const maxLength of [400, 200, 0]) {
      if (payloadBytes(reduced) <= MAX_PUBLIC_EVENT_PAYLOAD_BYTES) break;
      if (maxLength === 0) delete result.excerpt;
      else result.excerpt = result.excerpt.slice(0, maxLength);
    }
  }
  if (typeof detail.quote === "string") {
    for (const maxLength of [300, 150, 0]) {
      if (payloadBytes(reduced) <= MAX_PUBLIC_EVENT_PAYLOAD_BYTES) break;
      if (maxLength === 0) delete detail.quote;
      else detail.quote = detail.quote.slice(0, maxLength);
    }
  }
  return reduced;
}

function assertNoSensitiveKeys(value: unknown, seen = new WeakSet<object>()): void {
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && containsCredential(value)) {
      throw new AiReadingDomainError("READING_EVENT_PUBLIC_PAYLOAD_SENSITIVE", "public payload contains credential-shaped text");
    }
    return;
  }
  if (seen.has(value)) invalidPublicPayload("public payload must not contain cycles");
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertNoSensitiveKeys(item, seen);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (/^(reasoning_?content|system_?prompt|api_?key|authorization|cookie|token|secret|password|response_?body|raw_?response|upstream_?response)$/iu.test(key)) {
      throw new AiReadingDomainError("READING_EVENT_PUBLIC_PAYLOAD_SENSITIVE", `public payload contains forbidden field ${key}`);
    }
    assertNoSensitiveKeys(item, seen);
  }
}

function containsCredential(value: string): boolean {
  return /\bBearer\s+(?!\[Redacted\])\S+/iu.test(value)
    || /\bsk-[A-Za-z0-9_-]{6,}\b/iu.test(value)
    || /\b(api[ _-]?key|authorization|cookie|token|secret|password)\s*[:=]\s*(?!\[Redacted\])\S+/iu.test(value);
}

function assertOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (!hasOnlyKeys(value, keys)) invalidPublicPayload("public detail contains unknown fields");
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) invalidPublicPayload(`${field} must be an object`);
  return value;
}

function requiredString(value: Record<string, unknown>, field: string, maxLength: number): void {
  if (typeof value[field] !== "string" || value[field].length === 0 || value[field].length > maxLength) {
    invalidPublicPayload(`${field} must be a non-empty string of at most ${maxLength} characters`);
  }
}

function optionalString(value: Record<string, unknown>, field: string, maxLength: number): void {
  if (value[field] !== undefined && (typeof value[field] !== "string" || value[field].length > maxLength)) {
    invalidPublicPayload(`${field} must be a string of at most ${maxLength} characters`);
  }
}

function requiredNonNegativeInteger(value: Record<string, unknown>, field: string): void {
  if (!Number.isSafeInteger(value[field]) || Number(value[field]) < 0) {
    invalidPublicPayload(`${field} must be a non-negative safe integer`);
  }
}

function optionalNonNegativeInteger(value: Record<string, unknown>, field: string): void {
  if (value[field] !== undefined) requiredNonNegativeInteger(value, field);
}

function optionalBoolean(value: Record<string, unknown>, field: string): void {
  if (value[field] !== undefined && typeof value[field] !== "boolean") invalidPublicPayload(`${field} must be boolean`);
}

function optionalStringArray(
  value: Record<string, unknown>,
  field: string,
  maxItems: number,
  maxLength: number,
  required = false,
): void {
  const items = value[field];
  if (items === undefined && !required) return;
  if (!Array.isArray(items) || items.length > maxItems) invalidPublicPayload(`${field} must be a bounded string array`);
  if (items.some((item) => typeof item !== "string" || item.length === 0 || item.length > maxLength)) {
    invalidPublicPayload(`${field} contains an invalid string`);
  }
}

function invalidPublicPayload(message: string): never {
  throw new AiReadingDomainError("READING_EVENT_PUBLIC_PAYLOAD_INVALID", message);
}

function isKind(value: unknown): value is PublicReadingEventKind {
  return typeof value === "string" && ["task", "plan", "agent", "commentary", "tool", "evidence", "answer", "budget", "recovery"].includes(value);
}

function payloadBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}
