import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  authenticationIsFresh,
  isRegressionCasePassing,
  isResumableRegressionCase,
  matchesRequestedBook,
  regressionErrorCode,
  retryAfterMs,
  selectReferencedEvidence,
} from "./ai-reading-regression-lib.mjs";

const baseUrl = process.env.AI_REGRESSION_BASE_URL ?? "http://127.0.0.1:3000";
const email = process.env.AI_REGRESSION_EMAIL;
const password = process.env.AI_REGRESSION_PASSWORD;
const outputPath = resolve(process.argv[2] ?? "data/ai-reading-regression-20260808.json");
const terminalStatuses = new Set(["completed", "partial", "failed", "cancelled"]);

if (!email || !password) {
  throw new Error("AI_REGRESSION_EMAIL and AI_REGRESSION_PASSWORD are required");
}

const cases = [
  {
    index: 1,
    bookId: 48,
    book: "棉花帝国",
    titleIncludes: "棉花帝国",
    budget: "standard",
    question: "这本书的精华部分在哪？你最推荐阅读哪些部分？",
  },
  {
    index: 2,
    bookId: 50,
    book: "百年孤独",
    titleIncludes: "百年孤独",
    budget: "standard",
    question: "这本书为什么是文学经典，受到那么多人喜爱？我完全没读过，只听说它很传奇。你能给我讲讲它经典在哪里、故事大概是什么吗？如果能吸引我阅读就更好了。",
  },
  {
    index: 3,
    bookId: 48,
    book: "棉花帝国",
    titleIncludes: "棉花帝国",
    budget: "quick",
    question: "这本书是干嘛的？主要讲了什么？什么样的人会喜欢这本书？",
  },
  {
    index: 4,
    bookId: 48,
    book: "棉花帝国",
    titleIncludes: "棉花帝国",
    budget: "standard",
    question: "我只听说棉花和资本主义有关，但完全不知道两者为什么能扯上关系。我不想把整本书都读完，只想弄明白这个问题，应该读哪些部分？按什么顺序读？",
  },
  {
    index: 5,
    bookId: 13,
    book: "人类简史",
    titleIncludes: "人类简史",
    budget: "standard",
    question: "这本书经常被推荐，但我听说它很厚，而且有些观点争议很大。作为一个完全没读过的人，我能从中获得什么？如果只有两小时，最值得读哪些部分？",
  },
  {
    index: 6,
    bookId: 49,
    book: "UNIX编程艺术",
    titleIncludes: "UNIX编程艺术",
    budget: "quick",
    question: "这是一本很多年前的编程书，而我使用的是现代开发工具。它现在还值得读吗？哪些内容今天仍然有用，哪些内容可以跳过？",
  },
  {
    index: 7,
    bookId: 8,
    book: "学会提问",
    titleIncludes: "学会提问",
    budget: "quick",
    question: "我经常看完新闻或网上的观点后不知道该不该相信。这本书能帮我解决这个问题吗？如果想尽快学会一些马上能用的方法，我应该先读哪里？",
  },
  {
    index: 8,
    bookId: 2,
    book: "被讨厌的勇气",
    titleIncludes: "被讨厌的勇气",
    budget: "quick",
    question: "我因为在意别人的评价和人际关系而感到内耗，听说这本书可能有帮助。它主要会告诉我什么？哪些部分最适合我？它有没有可能让人误解或走极端的地方？",
  },
  {
    index: 9,
    bookId: 10,
    book: "AI工程",
    titleIncludes: "AI工程",
    budget: "quick",
    question: "我会调用大模型 API，但没有真正开发过 Agent 或可靠的 AI 产品。这本书适合我吗？我应该从哪些部分开始，需要先掌握什么？",
  },
  {
    index: 10,
    bookId: 11,
    book: "第一性原理",
    titleIncludes: "第一性原理",
    budget: "quick",
    question: "我的科学基础比较薄弱，但想改善自己分析问题的方式。这本书到底是科普书还是思维方法书？我能从中获得什么？如果先花一小时试读，应该读哪里？",
  },
];

const checkpoint = existsSync(outputPath)
  ? JSON.parse(readFileSync(outputPath, "utf8"))
  : {
      startedAt: new Date().toISOString(),
      baseUrl,
      modelId: null,
      cases: [],
    };

let accessToken = "";

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    const error = new Error(payload.message ?? `HTTP ${response.status}`);
    error.code = payload.code ?? response.status;
    error.status = response.status;
    error.retryAfterMs = retryAfterMs(response.headers.get("retry-after"));
    error.details = payload.details;
    throw error;
  }
  return payload.data;
}

function save() {
  writeFileSync(outputPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
}

function taskDurationMs(task) {
  if (!task.startedAt) return 0;
  const end = task.completedAt ?? new Date().toISOString();
  return Math.max(0, Date.parse(end) - Date.parse(task.startedAt));
}

function referencedEvidenceIds(task) {
  const items = [
    ...(task.result?.bookFindings ?? []),
    ...(task.result?.inferences ?? []),
  ];
  return [...new Set(items.flatMap((item) => item.evidenceIds ?? []))];
}

async function allEvents(conversationId, turnId) {
  const events = [];
  let afterSequence = 0;
  let hasMore = true;
  while (hasMore) {
    const page = await request(
      `/api/v1/ai-reading/conversations/${encodeURIComponent(conversationId)}`
      + `/turns/${encodeURIComponent(turnId)}/events?afterSequence=${afterSequence}&limit=200`,
    );
    events.push(...page.items);
    afterSequence = page.nextSequence;
    hasMore = page.hasMore;
  }
  return events;
}

async function validateCitations(testCase, task) {
  const evidence = Array.isArray(task.evidence)
    ? task.evidence
    : Object.values(task.evidence ?? {});
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const references = referencedEvidenceIds(task);
  const owned = references.every((id) => evidenceById.has(id));
  const referencedEvidence = selectReferencedEvidence(evidence, references);
  const checks = [];
  for (const item of referencedEvidence) {
    const locator = item.citation?.locator;
    if (!locator || Number(locator.bookId) !== testCase.bookId) {
      checks.push(false);
      continue;
    }
    try {
      const read = await request("/api/v1/reader-tools/read", {
        method: "POST",
        body: { locator, direction: "around", maxChars: 8_000 },
      });
      checks.push(typeof item.quote === "string" && item.quote.length > 0 && read.text.includes(item.quote));
    } catch {
      checks.push(false);
    }
  }
  return {
    valid: owned && references.length > 0 && evidence.length > 0 && checks.every(Boolean),
    owned,
    referencedCount: references.length,
    rereadValidCount: checks.filter(Boolean).length,
  };
}

async function runCase(testCase) {
  const existing = checkpoint.cases.find((item) => item.index === testCase.index);
  if (existing?.finalStatus && terminalStatuses.has(existing.finalStatus)) {
    if (!isRegressionCasePassing(existing)) {
      process.stdout.write(`[${testCase.index}/10] ${testCase.book}: resume-skip ${existing.finalStatus}\n`);
      const failed = {
        ...existing,
        terminalReason: existing.terminalReason ?? existing.errorCode ?? existing.finalStatus,
      };
      const error = new Error(`REGRESSION_CASE_FAILED:${testCase.index}:${existing.taskId}`);
      error.result = failed;
      throw error;
    }
    if (existing.citationValidity?.valid !== true && existing.conversationId && existing.turnId) {
      const turn = await request(
        `/api/v1/ai-reading/conversations/${encodeURIComponent(existing.conversationId)}`
        + `/turns/${encodeURIComponent(existing.turnId)}`,
      );
      const citationValidity = await validateCitations(testCase, turn.task);
      const refreshed = { ...existing, citationValidity };
      checkpoint.cases = checkpoint.cases.map((item) => item.index === testCase.index ? refreshed : item);
      save();
      process.stdout.write(
        `[${testCase.index}/10] ${testCase.book}: resume-revalidate ${existing.finalStatus}, citations=${citationValidity.valid}\n`,
      );
      if (!citationValidity.valid) {
        const error = new Error(`REGRESSION_CASE_FAILED:${testCase.index}:${existing.taskId}`);
        error.result = refreshed;
        throw error;
      }
      return refreshed;
    }
    process.stdout.write(`[${testCase.index}/10] ${testCase.book}: resume-skip ${existing.finalStatus}\n`);
    return existing;
  }

  await ensureAuthenticated();

  let metadata;
  try {
    metadata = await request(`/api/v1/reader-tools/books/${testCase.bookId}/metadata`);
  } catch (error) {
    const blocked = {
      ...testCase,
      finalStatus: "blocked",
      errorCode: String(error.code ?? "BOOK_NOT_FOUND"),
      blockedReason: "指定书籍不存在或无法读取",
    };
    checkpoint.cases = [...checkpoint.cases.filter((item) => item.index !== testCase.index), blocked]
      .sort((left, right) => left.index - right.index);
    save();
    return blocked;
  }
  if (!matchesRequestedBook(metadata, testCase.titleIncludes)) {
    const blocked = {
      ...testCase,
      finalStatus: "blocked",
      errorCode: "BOOK_TITLE_MISMATCH",
      blockedReason: `bookId ${testCase.bookId} 不是指定书籍`,
    };
    checkpoint.cases = [...checkpoint.cases.filter((item) => item.index !== testCase.index), blocked]
      .sort((left, right) => left.index - right.index);
    save();
    return blocked;
  }

  let conversationId;
  let createdTurn;
  if (isResumableRegressionCase(existing)) {
    conversationId = existing.conversationId;
    createdTurn = { id: existing.turnId, taskId: existing.taskId, status: existing.finalStatus };
    process.stdout.write(
      `[${testCase.index}/10] ${testCase.book}: resume-attach taskId=${createdTurn.taskId} ${createdTurn.status}\n`,
    );
  } else {
    const created = await request("/api/v1/ai-reading/conversations", {
      method: "POST",
      body: {
        bookId: testCase.bookId,
        message: testCase.question,
        budgetTier: testCase.budget,
      },
    });
    conversationId = created.id;
    createdTurn = created.turns[0];
    const inProgress = {
      ...testCase,
      conversationId,
      turnId: createdTurn.id,
      taskId: createdTurn.taskId,
      finalStatus: createdTurn.status,
      createdAt: createdTurn.createdAt,
    };
    checkpoint.cases = [...checkpoint.cases.filter((item) => item.index !== testCase.index), inProgress]
      .sort((left, right) => left.index - right.index);
    save();
    process.stdout.write(
      `[${testCase.index}/10] ${testCase.book}: conversationId=${conversationId} taskId=${createdTurn.taskId} queued\n`,
    );
  }

  const timeoutMs = testCase.budget === "standard" ? 12 * 60_000 : 5 * 60_000;
  const deadline = Date.now() + timeoutMs;
  let turn = createdTurn;
  let task = null;
  let lastModelTurns = -1;
  while (!terminalStatuses.has(turn.status)) {
    if (Date.now() >= deadline) throw new Error(`REGRESSION_POLL_TIMEOUT:${createdTurn.taskId}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
    turn = await request(
      `/api/v1/ai-reading/conversations/${encodeURIComponent(conversationId)}`
      + `/turns/${encodeURIComponent(createdTurn.id)}`,
    );
    task = turn.task;
    const turns = Number(task.budget?.used?.modelTurns ?? 0);
    if (turns !== lastModelTurns) {
      process.stdout.write(`[${testCase.index}/10] ${testCase.book}: ${task.status}, modelTurns=${turns}\n`);
      lastModelTurns = turns;
    }
  }
  task = turn.task;

  const events = await allEvents(conversationId, createdTurn.id);
  const citations = await validateCitations(testCase, task);
  const failureEvent = [...events].reverse().find((event) =>
    ["task_failed", "task_cancelled", "task_partial"].includes(event.type));
  const terminalReason = regressionErrorCode(task, failureEvent);
  const promptTokens = Number(task.budget?.used?.promptTokens ?? 0);
  const cacheReadInputTokens = Number(task.budget?.used?.cacheReadInputTokens ?? 0);
  const uncachedInputTokens = Number(task.budget?.used?.uncachedInputTokens ?? 0);
  const result = {
    ...testCase,
    conversationId,
    turnId: createdTurn.id,
    taskId: task.id,
    finalStatus: task.status,
    modelTurns: Number(task.budget?.used?.modelTurns ?? 0),
    toolCalls: Number(task.budget?.used?.toolCalls ?? 0),
    readCharacters: Number(task.budget?.used?.readCharacters ?? 0),
    promptTokens,
    cacheReadInputTokens,
    uncachedInputTokens,
    cacheHitRatio: promptTokens > 0 ? cacheReadInputTokens / promptTokens : null,
    cacheMissRatio: promptTokens > 0 ? uncachedInputTokens / promptTokens : null,
    subagents: (task.agents ?? []).filter((agent) => agent.kind === "subagent").length,
    evidenceCount: Array.isArray(task.evidence) ? task.evidence.length : Object.keys(task.evidence ?? {}).length,
    citationValidity: citations,
    durationMs: taskDurationMs(task),
    errorCode: terminalReason,
    terminalReason: task.status === "completed" ? null : terminalReason ?? task.status,
    modelCallIds: [...new Set(events.map((event) => event.modelCallId).filter(Boolean))],
    toolCallIds: [...new Set(events.map((event) => event.toolCallId).filter(Boolean))],
    actualToolPath: events
      .filter((event) => event.type === "tool_started")
      .map((event) => event.payload?.toolName)
      .filter(Boolean),
    startedAt: task.startedAt,
    finishedAt: task.completedAt,
  };
  checkpoint.cases = [...checkpoint.cases.filter((item) => item.index !== testCase.index), result]
    .sort((left, right) => left.index - right.index);
  save();
  process.stdout.write(`[${testCase.index}/10] ${testCase.book}: ${task.status}, evidence=${result.evidenceCount}, citations=${citations.valid}\n`);
  if (!isRegressionCasePassing(result)) {
    const error = new Error(`REGRESSION_CASE_FAILED:${testCase.index}:${task.id}`);
    error.result = result;
    throw error;
  }
  return result;
}

let authenticatedAt = 0;

async function ensureAuthenticated() {
  if (accessToken && authenticationIsFresh(authenticatedAt)) return;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    accessToken = "";
    try {
      const login = await request("/api/v1/auth/login", {
        method: "POST",
        body: { email, password },
      });
      accessToken = login.accessToken;
      authenticatedAt = Date.now();
      return;
    } catch (error) {
      if (error?.status !== 429 || attempt === 1) throw error;
      process.stdout.write(`AUTH_RATE_LIMITED retryingAfterMs=${error.retryAfterMs}\n`);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, error.retryAfterMs));
    }
  }
}

await ensureAuthenticated();
const modelConfig = await request("/api/v1/ai-reading/model-config");
if (modelConfig.modelId !== "deepseek-v4-flash" || modelConfig.hasApiKey !== true) {
  throw new Error("MODEL_CONFIG_INVALID");
}
checkpoint.modelId = modelConfig.modelId;
save();

for (const testCase of cases) {
  try {
    await runCase(testCase);
  } catch (error) {
    if (!error?.result) throw error;
    process.stdout.write(`[${testCase.index}/10] ${testCase.book}: failure-recorded, continuing\n`);
  }
}
checkpoint.finishedAt = new Date().toISOString();
save();
const failedIndices = checkpoint.cases
  .filter((result) => !isRegressionCasePassing(result))
  .map((result) => result.index);
process.stdout.write(
  `AI_READING_REGRESSION_COMPLETE cases=${checkpoint.cases.length} failures=${failedIndices.length}`
  + `${failedIndices.length > 0 ? ` failedIndices=${failedIndices.join(",")}` : ""}\n`,
);
if (failedIndices.length > 0) process.exitCode = 1;
