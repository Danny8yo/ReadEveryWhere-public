import { authCookie, sessionHeaders } from "./auth-session.helper";
import AdmZip from "adm-zip";
import { INestApplication, Logger, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { NextFunction, Request, Response } from "express";
import request from "supertest";
import { LanguageModelGateway } from "../src/support/ai-model/application/language-model.gateway";
import type { ModelCompletion, ModelCompletionRequest } from "../src/modules/ai-reading/application/ports/language-model.port";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/platform/http/all-exceptions.filter";
import { SuccessResponseInterceptor } from "../src/platform/http/success-response.interceptor";
import { SqliteService } from "../src/platform/persistence/sqlite/sqlite.service";
import { ReadingTaskRepository } from "../src/modules/ai-reading/infrastructure/reading-task.repository";
import { AgentRunRepository } from "../src/modules/ai-reading/infrastructure/agent-run.repository";
import { BudgetLedgerRepository } from "../src/modules/ai-reading/infrastructure/budget-ledger.repository";
import { AiReadingScheduler } from "../src/modules/ai-reading/infrastructure/ai-reading-scheduler";

describe("AI Reading API (e2e)", () => {
  let app: INestApplication;
  let userOneToken = "";
  let userTwoToken = "";
  let bookId = 0;
  let fakeDeepSeek: FakeDeepSeek;
  const runRoot = resolve(process.cwd(), "tmp", `ai-reading-${randomUUID()}`);
  const databasePath = resolve(runRoot, "ai-reading.sqlite");

  beforeAll(async () => {
    process.env.SQLITE_PATH = databasePath;
    process.env.DOWNLOAD_STORAGE_PATH = resolve(runRoot, "downloads");
    process.env.READER_CONTENT_CACHE_PATH = resolve(runRoot, "reader-content");
    process.env.JWT_SECRET = "ai-reading-e2e-secret";
    process.env.ENCRYPTION_KEY = "b".repeat(64);
    fakeDeepSeek = new FakeDeepSeek();

    app = await createApplication(fakeDeepSeek);

    userOneToken = await register(app, "ai-reader-one@example.com");
    userTwoToken = await register(app, "ai-reader-two@example.com");
    const imported = await request(app.getHttpServer())
      .post("/api/v1/library/books/import")
      .set(sessionHeaders(userOneToken))
      .attach("file", createEpub(), { filename: "ai-reading.epub", contentType: "application/epub+zip" })
      .expect(201);
    bookId = imported.body.data.book.id;

    const profile = await request(app.getHttpServer())
      .patch(`/api/v1/library/books/${bookId}/reading-profile`)
      .set(sessionHeaders(userOneToken))
      .send({
        primaryGenre: "technical",
        secondaryGenres: [],
        classificationSummary: "测试书按证据导向的技术结构组织。",
      })
      .expect(200);
    expect(profile.body.data).toMatchObject({
      confidence: { kind: "user-determined", score: null },
      profileVersion: 2,
    });
    await request(app.getHttpServer())
      .put("/api/v1/ai-reading/model-config")
      .set(sessionHeaders(userOneToken))
      .send({ apiKey: "sk-e2e-private", modelId: "deepseek-v4-flash" })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
    rmSync(runRoot, { recursive: true, force: true });
  });

  it("encrypts per-user DeepSeek config and does not return the API key", async () => {
    const initial = await request(app.getHttpServer())
      .get("/api/v1/ai-reading/model-config")
      .set(sessionHeaders(userOneToken))
      .expect(200);
    expect(initial.body.data).toMatchObject({ modelId: "deepseek-v4-flash", hasApiKey: true });

    const saved = await request(app.getHttpServer())
      .put("/api/v1/ai-reading/model-config")
      .set(sessionHeaders(userOneToken))
      .send({ apiKey: "sk-e2e-private", modelId: "deepseek-v4-flash" })
      .expect(200);
    expect(saved.body.data.hasApiKey).toBe(true);
    expect(JSON.stringify(saved.body)).not.toContain("sk-e2e-private");
    expect(readFileSync(databasePath).toString()).not.toContain("sk-e2e-private");

    const other = await request(app.getHttpServer())
      .get("/api/v1/ai-reading/model-config")
      .set(sessionHeaders(userTwoToken))
      .expect(200);
    expect(other.body.data.hasApiKey).toBe(false);

    const tested = await request(app.getHttpServer())
      .post("/api/v1/ai-reading/model-config/test")
      .set(sessionHeaders(userOneToken))
      .send({})
      .expect(201);
    expect(tested.body.data).toMatchObject({ ok: true, modelId: "deepseek-v4-flash" });
  });

  it("publishes the versioned preset values and server-authoritative constraints", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/ai-reading/budget-config")
      .set(sessionHeaders(userOneToken))
      .expect(200);

    expect(response.body.data).toEqual({
      version: 2,
      presets: {
        quick: {
          maxModelTurns: 60,
          maxToolCalls: 90,
          maxReadCharacters: 250_000,
          maxDurationMs: 30 * 60_000,
          maxDelegatedAgents: 0,
          maxConcurrentAgents: 0,
        },
        standard: {
          maxModelTurns: 90,
          maxToolCalls: 135,
          maxReadCharacters: 500_000,
          maxDurationMs: 45 * 60_000,
          maxDelegatedAgents: 2,
          maxConcurrentAgents: 2,
        },
        deep: {
          maxModelTurns: 120,
          maxToolCalls: 180,
          maxReadCharacters: 750_000,
          maxDurationMs: 60 * 60_000,
          maxDelegatedAgents: 6,
          maxConcurrentAgents: 3,
        },
      },
      constraints: {
        maxModelTurns: { min: 3, max: 200, step: 1 },
        maxToolCalls: { min: 3, max: 300, step: 1 },
        maxReadCharacters: { min: 4_000, max: 2_000_000, step: 1_000 },
        maxDurationMs: { min: 60_000, max: 7_200_000, step: 60_000 },
        maxDelegatedAgents: { min: 0, max: 12, step: 1 },
        maxConcurrentAgents: { min: 0, max: 3, step: 1 },
      },
      executionLimits: {
        maxDelegationDepth: 2,
        maxChildrenPerAgent: 3,
        maxDelegatedAgentsPerDepth: 3,
        maxActiveTurns: 2,
        maxActiveAgentRuns: 4,
        childMaxModelTurns: 8,
        childMaxToolCalls: 12,
        childMaxReadCharacters: 48_000,
        childMaxExecutionMs: 180_000,
      },
    });
  });

  it("disables the V2 conversation API through its single feature flag", async () => {
    const disabledRoot = resolve(runRoot, `disabled-${randomUUID()}`);
    const previous = {
      sqlitePath: process.env.SQLITE_PATH,
      downloadPath: process.env.DOWNLOAD_STORAGE_PATH,
      contentPath: process.env.READER_CONTENT_CACHE_PATH,
      conversationsEnabled: process.env.AI_READING_CONVERSATIONS_ENABLED,
    };
    process.env.SQLITE_PATH = resolve(disabledRoot, "disabled.sqlite");
    process.env.DOWNLOAD_STORAGE_PATH = resolve(disabledRoot, "downloads");
    process.env.READER_CONTENT_CACHE_PATH = resolve(disabledRoot, "reader-content");
    process.env.AI_READING_CONVERSATIONS_ENABLED = "false";
    const disabledApp = await createApplication(new FakeDeepSeek());
    try {
      const token = await register(disabledApp, `disabled-${randomUUID()}@example.com`);
      for (const probe of [
        () => request(disabledApp.getHttpServer())
          .get("/api/v1/ai-reading/conversations?bookId=1&page=1&pageSize=20"),
        () => request(disabledApp.getHttpServer())
          .post("/api/v1/ai-reading/conversations")
          .set("Origin", "http://localhost:5173")
          .send({ bookId: 1, message: "不应创建", budgetTier: "quick" }),
      ]) {
        const response = await probe().set(sessionHeaders(token)).expect(404);
        expect(response.body).toMatchObject({ details: { reason: "CONVERSATIONS_DISABLED" } });
      }

      await request(disabledApp.getHttpServer())
        .get("/api/v1/ai-reading/tasks?bookId=1&page=1&pageSize=20")
        .set(sessionHeaders(token))
        .expect(404);
    } finally {
      await disabledApp.close();
      rmSync(disabledRoot, { recursive: true, force: true });
      restoreEnv("SQLITE_PATH", previous.sqlitePath);
      restoreEnv("DOWNLOAD_STORAGE_PATH", previous.downloadPath);
      restoreEnv("READER_CONTENT_CACHE_PATH", previous.contentPath);
      restoreEnv("AI_READING_CONVERSATIONS_ENABLED", previous.conversationsEnabled);
    }
  });


  it("returns framework 404 for every removed V1 task route", async () => {
    const probes = [
      () => request(app.getHttpServer()).get("/api/v1/ai-reading/tasks?bookId=1&page=1&pageSize=20"),
      () => request(app.getHttpServer()).post("/api/v1/ai-reading/tasks")
      .set("Origin", "http://localhost:5173")
        .send({ bookId, goal: "removed", budgetTier: "quick" }),
      () => request(app.getHttpServer()).get("/api/v1/ai-reading/tasks/removed"),
      () => request(app.getHttpServer()).get("/api/v1/ai-reading/tasks/removed/events"),
      () => request(app.getHttpServer()).post("/api/v1/ai-reading/tasks/removed/cancel")
      .set("Origin", "http://localhost:5173"),
      () => request(app.getHttpServer()).delete("/api/v1/ai-reading/tasks/removed")
      .set("Origin", "http://localhost:5173"),
    ];
    for (const probe of probes) {
      const response = await probe().set(sessionHeaders(userOneToken)).expect(404);
      expect(response.body.details?.reason).not.toBe("CONVERSATIONS_DISABLED");
    }
  });

  it("runs a recursive first turn plus three HTTP follow-ups with current-task evidence", async () => {
    const requestStart = fakeDeepSeek.requests.length;
    const created = await request(app.getHttpServer())
      .post("/api/v1/ai-reading/conversations")
      .set(sessionHeaders(userOneToken))
      .send({
        bookId,
        message: "递归委派核验作者如何用证据建立并限制核心论证",
        budgetTier: "deep",
        readerFocus: { sectionIndex: 0, chapterLabel: "伪造章节标题" },
      })
      .expect(201);
    const conversationId = created.body.data.id as string;
    const firstTurn = created.body.data.turns[0];
    const turnDetails = [await waitForConversationTurn(app, userOneToken, conversationId, firstTurn.id)];
    expect(turnDetails[0]).toMatchObject({ status: "completed", task: { status: "completed" } });
    expect(turnDetails[0].task.agents.map((agent: any) => agent.depth)).toEqual([0, 1, 2]);
    expect(turnDetails[0].task.evidence.length).toBeGreaterThan(0);

    for (const message of ["解释上一条", "换个角度继续读这一章", "引用依据"]) {
      const followUp = await request(app.getHttpServer())
        .post(`/api/v1/ai-reading/conversations/${conversationId}/turns`)
        .set(sessionHeaders(userOneToken))
        .send({ message, budgetTier: "standard" })
        .expect(201);
      turnDetails.push(await waitForConversationTurn(
        app, userOneToken, conversationId, followUp.body.data.turn.id,
      ));
    }

    expect(new Set(turnDetails.map((turn) => turn.taskId)).size).toBe(4);
    expect(turnDetails.every((turn) => turn.status === "completed")).toBe(true);
    for (const turn of turnDetails.slice(1)) {
      expect(turn.task.evidence).not.toHaveLength(0);
      const currentEvidenceIds = new Set(turn.task.evidence.map((item: any) => item.id));
      expect(turn.task.result.bookFindings[0].evidenceIds).not.toHaveLength(0);
      expect(turn.task.result.bookFindings[0].evidenceIds.every(
        (evidenceId: string) => currentEvidenceIds.has(evidenceId),
      )).toBe(true);
    }

    const database = app.get(SqliteService).getDatabase();
    expect(database.prepare(`SELECT COUNT(1) AS count FROM ai_reading_task_budgets b
      INNER JOIN reading_conversation_turns t ON t.task_id=b.task_id WHERE t.conversation_id=?`)
      .get(conversationId)).toEqual({ count: 4 });
    expect(database.prepare(`SELECT COUNT(1) AS count FROM reading_conversation_checkpoints
      WHERE conversation_id=?`).get(conversationId)).toEqual({ count: 4 });
    const imports = database.prepare(`SELECT COUNT(1) AS count FROM ai_reading_evidence e
      INNER JOIN reading_conversation_turns t ON t.task_id=e.task_id
      WHERE t.conversation_id=? AND e.provenance_kind='conversation_import'`)
      .get(conversationId) as unknown as { count: number };
    expect(Number(imports.count)).toBe(3);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/ai-reading/conversations/${conversationId}`)
      .set(sessionHeaders(userOneToken))
      .expect(200);
    expect(detail.body.data).toMatchObject({
      id: conversationId,
      usage: { promptTokens: expect.any(Number), completionTokens: expect.any(Number), totalTokens: expect.any(Number) },
      turns: expect.arrayContaining([expect.objectContaining({ turnNumber: 4, status: "completed" })]),
    });
    expect(detail.body.data.usage.totalTokens).toBeGreaterThan(0);

    const fourthTurnRequests = fakeDeepSeek.requests.slice(requestStart).filter((modelRequest) => (
      modelRequest.trace?.taskId === turnDetails[3].taskId
    ));
    expect(fourthTurnRequests).not.toHaveLength(0);
    const fourthTurnContext = JSON.stringify(fourthTurnRequests);
    expect(fourthTurnContext).toContain("引用依据");
    expect(fourthTurnContext).toContain("turnSummaries");
    for (const privateTranscript of [
      "private assistant transcript:递归委派核验作者如何用证据建立并限制核心论证",
      "private assistant transcript:解释上一条",
      "private assistant transcript:换个角度继续读这一章",
    ]) {
      expect(fourthTurnContext).not.toContain(privateTranscript);
    }

    const page = await request(app.getHttpServer())
      .get(`/api/v1/ai-reading/conversations/${conversationId}/turns/${turnDetails[3].id}/events?afterSequence=0&limit=1`)
      .set(sessionHeaders(userOneToken))
      .expect(200);
    expect(page.body.data).toMatchObject({ hasMore: true, items: [expect.objectContaining({ sequence: 1 })] });
    const allEvents = await request(app.getHttpServer())
      .get(`/api/v1/ai-reading/conversations/${conversationId}/turns/${turnDetails[3].id}/events?afterSequence=0&limit=200`)
      .set(sessionHeaders(userOneToken))
      .expect(200);
    expect(allEvents.body.data.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "evidence_imported",
        payload: expect.objectContaining({
          kind: "evidence",
          detail: expect.objectContaining({ provenanceKind: "conversation_import", importedCount: 1 }),
        }),
      }),
    ]));
    const serializedEvents = JSON.stringify(allEvents.body.data.items);
    for (const secret of ["sk-e2e-private", "reasoning_content", "systemPrompt", "<untrusted_tool_output>"]) {
      expect(serializedEvents).not.toContain(secret);
    }

    await request(app.getHttpServer())
      .get(`/api/v1/ai-reading/conversations/${conversationId}`)
      .set(sessionHeaders(userTwoToken))
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/v1/ai-reading/tasks/${turnDetails[3].taskId}`)
      .set(sessionHeaders(userOneToken))
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/api/v1/ai-reading/conversations/${conversationId}`)
      .set(sessionHeaders(userOneToken))
      .expect(200);
    expect(database.prepare("SELECT COUNT(1) AS count FROM reading_conversations WHERE id=?")
      .get(conversationId)).toEqual({ count: 0 });
    for (const turn of turnDetails) {
      expect(countRows(database, "ai_reading_tasks", turn.taskId)).toBe(0);
      expect(countRows(database, "ai_reading_task_budgets", turn.taskId)).toBe(0);
      expect(countRows(database, "ai_reading_evidence", turn.taskId)).toBe(0);
    }
  });

  it("exposes bounded retry failure context and explicitly imports failed-turn evidence", async () => {
    const created = await request(app.getHttpServer())
      .post("/api/v1/ai-reading/conversations")
      .set(sessionHeaders(userOneToken))
      .send({
        bookId,
        message: `[fail-after-read:${randomUUID()}] 读取证据后模拟模型连接失败`,
        budgetTier: "standard",
      })
      .expect(201);
    const conversationId = created.body.data.id as string;
    const sourceTurn = await waitForConversationTurn(
      app, userOneToken, conversationId, created.body.data.turns[0].id,
    );
    expect(sourceTurn).toMatchObject({ status: "failed", task: { status: "failed" } });
    expect(sourceTurn.task.evidence).toHaveLength(1);

    const retried = await request(app.getHttpServer())
      .post(`/api/v1/ai-reading/conversations/${conversationId}/turns/${sourceTurn.id}/retry`)
      .set(sessionHeaders(userOneToken))
      .send({ message: "请基于失败前已核验的证据继续", budgetTier: "standard" })
      .expect(201);
    expect(retried.body.data.turn).toMatchObject({
      retryOfTurnId: sourceTurn.id,
      retrySource: {
        sourceTurnId: sourceTurn.id,
        sourceStatus: "failed",
        failureCode: "MODEL_CONNECTION_FAILED",
        evidenceCandidates: [{
          sourceEvidenceId: sourceTurn.task.evidence[0].id,
          chapterPath: expect.any(String),
          quotePreview: expect.any(String),
        }],
      },
    });
    const serialized = JSON.stringify(retried.body.data.turn.retrySource);
    expect(serialized).not.toContain("sourceTextHash");
    expect(serialized).not.toContain("sourceLocator");
    expect(serialized).not.toContain("raw upstream secret");

    const completed = await waitForConversationTurn(
      app, userOneToken, conversationId, retried.body.data.turn.id,
    );
    expect(completed.status).toBe("completed");
    expect(completed.task.evidence).toEqual([expect.objectContaining({
      id: expect.not.stringMatching(new RegExp(`^${sourceTurn.task.evidence[0].id}$`)),
    })]);
    const imported = app.get(SqliteService).getDatabase().prepare(`SELECT source_task_id,source_evidence_id
      FROM ai_reading_evidence WHERE task_id=? AND provenance_kind='conversation_import'`)
      .get(completed.taskId) as unknown as { source_task_id: string; source_evidence_id: string };
    expect(imported).toEqual({
      source_task_id: sourceTurn.taskId,
      source_evidence_id: sourceTurn.task.evidence[0].id,
    });

    const retryRequests = fakeDeepSeek.requests.filter((modelRequest) => (
      modelRequest.trace?.taskId === completed.taskId
    ));
    expect(retryRequests.some((modelRequest) => (
      agentEnvelope(modelRequest)?.retrySource?.sourceTurnId === sourceTurn.id
    ))).toBe(true);
    expect(JSON.stringify(retryRequests)).not.toContain("raw upstream secret");
  });

  it("recovers a V2 model step after restart without duplicating the step or budget charge", async () => {
    app.get(AiReadingScheduler).onModuleDestroy();
    const created = await request(app.getHttpServer())
      .post("/api/v1/ai-reading/conversations")
      .set(sessionHeaders(userOneToken))
      .send({
        bookId,
        message: "服务重启后继续执行已持久化的单书模型步骤",
        budgetTier: "standard",
      })
      .expect(201);
    const conversationId = created.body.data.id as string;
    const turn = created.body.data.turns[0];
    const taskId = turn.taskId as string;
    const runs = app.get(AgentRunRepository);
    const budgets = app.get(BudgetLedgerRepository);
    const claimedAt = new Date().toISOString();
    const claim = runs.claimNext("worker-before-v2-restart", claimedAt, 4)!;
    expect(claim.run.taskId).toBe(taskId);
    const authority = { lease: claim.lease, now: claimedAt };
    const stepId = `${claim.run.id}:step:1`;
    expect(runs.startStep({
      id: stepId,
      taskId,
      agentRunId: claim.run.id,
      stepNo: 1,
      modelCallId: `${claim.run.id}:model:1`,
      kind: "model",
      status: "started",
      requestFingerprint: createHash("sha256").update(JSON.stringify({
        runId: claim.run.id,
        stepNo: 1,
        checkpoint: claim.run.checkpoint,
      })).digest("hex"),
      createdAt: claimedAt,
    }, authority)?.id).toBe(stepId);
    expect(budgets.reserve({
      id: `${stepId}:model`,
      taskId,
      agentRunId: claim.run.id,
      stepId,
      kind: "model",
      amount: { modelTurns: 1 },
      nodeLimits: claim.run.nodeLimits,
      now: claimedAt,
    }, authority)).toBe("reserved");
    expect(budgets.settle(`${stepId}:model`, {
      amount: { modelTurns: 1 },
      promptTokens: 20,
      completionTokens: 10,
      totalTokens: 30,
      settledAt: claimedAt,
    }, authority)).toBe(true);
    expect(runs.completeStep(stepId, {
      completion: toolCompletion("book_toc", { limit: 100 }),
      durationMs: 1,
    }, claimedAt, authority)).toBe(true);
    app.get(SqliteService).getDatabase().prepare(
      "UPDATE ai_reading_agent_runs SET lease_expires_at=? WHERE id=?",
    ).run("2000-01-01T00:00:00.000Z", claim.run.id);

    await app.close();
    app = await createApplication(fakeDeepSeek);

    const completed = await waitForConversationTurn(app, userOneToken, conversationId, turn.id);
    expect(completed).toMatchObject({ status: "completed", task: { status: "completed" } });
    const database = app.get(SqliteService).getDatabase();
    expect(database.prepare(
      "SELECT COUNT(1) AS count FROM ai_reading_agent_steps WHERE agent_run_id=? AND step_no=1",
    ).get(claim.run.id)).toEqual({ count: 1 });
    expect(database.prepare(
      "SELECT used_model_turns,reserved_model_turns FROM ai_reading_task_budgets WHERE task_id=?",
    ).get(taskId)).toEqual({ used_model_turns: 3, reserved_model_turns: 0 });
    expect(database.prepare(
      "SELECT lease_generation FROM ai_reading_agent_runs WHERE id=?",
    ).get(claim.run.id)).toEqual({ lease_generation: expect.any(Number) });
    const restoredGeneration = database.prepare(
      "SELECT lease_generation AS generation FROM ai_reading_agent_runs WHERE id=?",
    ).get(claim.run.id) as unknown as { generation: number };
    expect(restoredGeneration.generation).toBeGreaterThan(claim.lease.generation);
  });

  it("enforces one active turn and cascades cancellation through V2 runs and reservations", async () => {
    const message = `[hold-v2:${randomUUID()}] 保持会话活动以验证取消级联`;
    const created = await request(app.getHttpServer())
      .post("/api/v1/ai-reading/conversations")
      .set(sessionHeaders(userOneToken))
      .send({ bookId, message, budgetTier: "standard" })
      .expect(201);
    const conversationId = created.body.data.id as string;
    const turn = created.body.data.turns[0];
    await fakeDeepSeek.waitUntilHeld(message);

    await request(app.getHttpServer())
      .post(`/api/v1/ai-reading/conversations/${conversationId}/turns`)
      .set(sessionHeaders(userOneToken))
      .send({ message: "并发追问应被拒绝", budgetTier: "quick" })
      .expect(409)
      .expect(({ body }) => expect(body.details.reason).toBe("CONVERSATION_TURN_ACTIVE"));
    await request(app.getHttpServer())
      .delete(`/api/v1/ai-reading/conversations/${conversationId}`)
      .set(sessionHeaders(userOneToken))
      .expect(409);

    await request(app.getHttpServer())
      .post(`/api/v1/ai-reading/conversations/${conversationId}/turns/${turn.id}/cancel`)
      .set(sessionHeaders(userOneToken))
      .expect(201);
    const database = app.get(SqliteService).getDatabase();
    expect(database.prepare("SELECT status FROM reading_conversation_turns WHERE id=?")
      .get(turn.id)).toEqual({ status: "cancelled" });
    const nonTerminalRuns = database.prepare(`SELECT COUNT(1) AS count FROM ai_reading_agent_runs
      WHERE task_id=? AND status NOT IN ('completed','partial','failed','cancelled')`)
      .get(turn.taskId) as unknown as { count: number };
    expect(Number(nonTerminalRuns.count)).toBe(0);
    expect(database.prepare(`SELECT COUNT(1) AS count FROM ai_reading_budget_reservations
      WHERE task_id=? AND status='reserved'`).get(turn.taskId)).toEqual({ count: 0 });

    await request(app.getHttpServer())
      .delete(`/api/v1/ai-reading/tasks/${turn.taskId}`)
      .set(sessionHeaders(userOneToken))
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/v1/ai-reading/conversations/${conversationId}`)
      .set(sessionHeaders(userOneToken))
      .expect(200);
    fakeDeepSeek.release(message);
  });

  it("permanently freezes a conversation when the EPUB content revision changes", async () => {
    const created = await request(app.getHttpServer())
      .post("/api/v1/ai-reading/conversations")
      .set(sessionHeaders(userOneToken))
      .send({ bookId, message: "先核验版本冻结前的证据", budgetTier: "quick" })
      .expect(201);
    const conversationId = created.body.data.id as string;
    await waitForConversationTurn(app, userOneToken, conversationId, created.body.data.turns[0].id);

    const database = app.get(SqliteService).getDatabase();
    const stored = database.prepare(`
      SELECT artifact.stored_path
      FROM book_current_artifacts current
      INNER JOIN book_artifacts artifact ON artifact.artifact_id = current.artifact_id
      WHERE current.book_id = ? AND artifact.status = 'active'
    `).get(bookId) as unknown as { stored_path: string };
    writeFileSync(resolve(runRoot, "downloads", stored.stored_path), createEpub("内容版本已经变化。"));

    await request(app.getHttpServer())
      .post(`/api/v1/ai-reading/conversations/${conversationId}/turns`)
      .set(sessionHeaders(userOneToken))
      .send({ message: "继续解释", budgetTier: "quick" })
      .expect(409)
      .expect(({ body }) => expect(body.details.reason).toBe("CONVERSATION_REVISION_CHANGED"));
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/ai-reading/conversations/${conversationId}`)
      .set(sessionHeaders(userOneToken))
      .expect(200);
    expect(detail.body.data).toMatchObject({ status: "frozen", frozenReason: "content_revision_changed" });
  });
});

class FakeDeepSeek {
  private readonly held = new Map<string, () => void>();
  private readonly released = new Set<string>();
  private readonly goalCalls = new Map<string, number>();
  readonly requests: ModelCompletionRequest[] = [];

  async complete(input: ModelCompletionRequest): Promise<ModelCompletion> {
    this.requests.push(structuredClone(input));
    const envelope = agentEnvelope(input);
    if (envelope) return this.completeConversation(input, envelope);
    const goal = rootGoal(input);
    if (goal) this.goalCalls.set(goal, (this.goalCalls.get(goal) ?? 0) + 1);
    if (goal?.startsWith("[hold:") && !this.released.has(goal)) {
      await new Promise<void>((resolve) => this.held.set(goal, resolve));
      this.released.add(goal);
      this.held.delete(goal);
    }
    const child = input.messages[0]?.content?.includes("child reading agent") ?? false;
    const called = input.messages.flatMap((message) => message.toolCalls?.map((call) => call.name) ?? []);
    if (!child) {
      if (!called.includes("update_plan")) {
        return toolCompletion("update_plan", {
          steps: [{ id: "locate", title: "定位并阅读证据", status: "in_progress" }],
          nextAction: "委派独立阅读",
        });
      }
      if (!called.includes("delegate_reading")) {
        return toolCompletion("delegate_reading", {
          subtasks: [{
            id: "child-evidence",
            goal: "定位书中证据句并解释其论证作用",
            deliverable: "返回证据句、解释和可核验引用",
          }],
        });
      }
      const delegation = lastToolOutput(input);
      const evidenceIds = delegation.results[0].evidenceIds;
      return toolCompletion("complete_task", {
        bookFindings: [{ id: "finding", statement: "书中证据句说明阅读必须可核验。", evidenceIds }],
        inferences: [],
        modelKnowledge: [],
        openQuestions: [],
        limitations: [],
      });
    }

    if (!called.includes("book_search_text")) {
      return toolCompletion("book_search_text", { query: "阅读必须以可核验证据为基础", limit: 5 });
    }
    if (!called.includes("book_read")) {
      const search = lastToolOutput(input);
      return toolCompletion("book_read", {
        locator: search.hits[0].citation.locator,
        direction: "around",
        maxChars: 500,
      });
    }
    const read = lastToolOutput(input);
    return toolCompletion("complete_subtask", {
      summary: "已定位证据句",
      findings: [{
        id: "child-finding",
        statement: "阅读必须以证据为基础",
        evidenceIds: [read.evidence[0].evidenceId],
      }],
      openQuestions: [],
    });
  }

  async waitUntilHeld(goal: string): Promise<void> {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      if (this.held.has(goal)) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Fake DeepSeek did not hold goal: ${goal}`);
  }

  release(goal: string): void {
    this.held.get(goal)?.();
  }

  callsForGoal(goal: string): number {
    return this.goalCalls.get(goal) ?? 0;
  }

  private async completeConversation(input: ModelCompletionRequest, envelope: any): Promise<ModelCompletion> {
    const message = String(envelope.currentMessage ?? "");
    if (message.startsWith("[hold-v2:") && !this.released.has(message)) {
      await new Promise<void>((resolve) => this.held.set(message, resolve));
      this.released.add(message);
      this.held.delete(message);
    }
    const called = input.messages.flatMap((item) => item.toolCalls?.map((call) => call.name) ?? []);
    const available = new Set(input.tools?.map((tool) => tool.function.name));
    const depth = Number(envelope.depth ?? 0);
    const recursive = String(envelope.rootGoal).includes("递归委派");
    const delegatedAgents = Number(envelope.budget?.task?.limits?.delegatedAgents ?? 0);
    const canDelegateAtDepth = depth === 0 ? delegatedAgents > 0 : delegatedAgents >= 6 && depth < 2;
    const sourceRefs = envelope.checkpoint?.memory?.sourceEvidenceRefs ?? [];
    const sourceRef = sourceRefs[sourceRefs.length - 1];
    const retryCandidate = envelope.retrySource?.evidenceCandidates?.[0];

    if (depth === 0 && retryCandidate && !called.includes("conversation_import_evidence")) {
      return toolCompletion("conversation_import_evidence", {
        sourceTurnId: envelope.retrySource.sourceTurnId,
        evidenceIds: [retryCandidate.sourceEvidenceId],
      }, `private assistant transcript:${message}`);
    }
    if (depth === 0 && sourceRef && !called.includes("conversation_import_evidence")) {
      return toolCompletion("conversation_import_evidence", {
        sourceTurnId: sourceRef.sourceTurnId,
        evidenceIds: [sourceRef.sourceEvidenceId],
      }, `private assistant transcript:${message}`);
    }

    if (!available.has("book_read") && available.has("book_read_from_toc")
      && !called.includes("book_read_from_toc") && !called.includes("conversation_import_evidence")) {
      const toc = lastToolOutput(input);
      return toolCompletion("book_read_from_toc", {
        nodeIds: [toc.entries[0].nodeId],
      });
    }
    if (!available.has("book_read") && available.has("book_toc") && !called.includes("book_toc")
      && !called.includes("conversation_import_evidence")) {
      return toolCompletion("book_toc", { limit: 100 });
    }

    const hasRead = called.includes("book_read") || called.includes("book_read_from_toc");

    if (message.startsWith("[fail-after-read:") && !envelope.retrySource) {
      if (!hasRead) return toolCompletion("book_read", startLocator());
      throw Object.assign(new Error("raw upstream secret"), { code: "MODEL_CONNECTION_FAILED" });
    }

    if (recursive && !sourceRef && !retryCandidate && canDelegateAtDepth && !called.includes("delegate_reading")) {
      const axis = depth === 0 ? "核心论证中的证据链" : "证据链中的限制条件";
      return plannedDelegationCompletion({ subtasks: [{
        id: `depth-${depth + 1}`,
        goal: `独立核验${axis}如何得到书内原文支持`,
        deliverable: `返回${axis}、证据引用和未决问题`,
      }] }, `private assistant transcript:${message}`);
    }
    if (depth > 0 && called.includes("delegate_reading")) {
      return toolCompletion("complete_subtask", {
        summary: "后代已完成独立核验",
        findings: [{ id: "child-finding", statement: "证据链支持并限制了核心论证。", evidenceIds: [latestEvidenceId(input)] }],
        openQuestions: [],
      });
    }
    if (depth > 0 && !hasRead) {
      return toolCompletion("book_read", startLocator());
    }
    if (depth > 0) {
      return toolCompletion("complete_subtask", {
        summary: "已核验限制条件",
        findings: [{ id: "grandchild-finding", statement: "原文给出了可核验的限制条件。", evidenceIds: [latestEvidenceId(input)] }],
        openQuestions: [],
      });
    }

    if (depth === 0 && !recursive && !hasRead && !called.includes("conversation_import_evidence")) {
      return toolCompletion("book_read", startLocator());
    }
    return toolCompletion("complete_turn", {
      bookFindings: [{ id: "finding", statement: "书中证据说明阅读结论必须能够返回原文。", evidenceIds: [latestEvidenceId(input)] }],
      inferences: [], modelKnowledge: [], openQuestions: [], limitations: [],
      memoryDelta: {
        turnSummary: `已完成：${message.slice(0, 80)}`,
        preferences: [], topics: [{ name: "证据可核验性", findingIndexes: [0] }],
        planSteps: [{ text: "核验书内证据", status: "completed" }],
        chapterRanges: [{ sectionIndex: 0, chapterLabel: "第一章" }],
      },
    });
  }
}

function toolCompletion(name: string, args: unknown, content: string | null = null): ModelCompletion {
  return {
    id: randomUUID(),
    model: "deepseek-v4-flash",
    message: {
      role: "assistant",
      content,
      toolCalls: [{ id: randomUUID(), name, arguments: JSON.stringify(args) }],
    },
    usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
    finishReason: "tool_calls",
    durationMs: 1,
    attempt: 1,
  };
}

function plannedDelegationCompletion(args: unknown, content: string | null = null): ModelCompletion {
  const completion = toolCompletion("delegate_reading", args, content);
  completion.message.toolCalls!.unshift({
    id: randomUUID(),
    name: "update_plan",
    arguments: JSON.stringify({
      steps: [
        { id: "primary-evidence", title: "核验核心主张与直接证据", status: "in_progress" },
        { id: "independent-limits", title: "核验跨章节反例与限制条件", status: "pending" },
      ],
    }),
  });
  return completion;
}

function lastToolOutput(input: ModelCompletionRequest): any {
  const content = [...input.messages].reverse().find((message) => message.role === "tool")?.content ?? "{}";
  const match = content.match(/<untrusted_tool_output>([\s\S]*)<\/untrusted_tool_output>/);
  return JSON.parse(match?.[1] ?? content);
}

function agentEnvelope(input: ModelCompletionRequest): any | null {
  let envelope: Record<string, unknown> | null = null;
  let runtime: Record<string, unknown> | null = null;
  for (const message of input.messages.filter((candidate) => candidate.role === "user")) {
    if (!message.content?.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(message.content);
      if (parsed.AgentContextEnvelopeV2) envelope = parsed.AgentContextEnvelopeV2;
      if (parsed.AgentRuntimeStateV1) runtime = parsed.AgentRuntimeStateV1;
    } catch { /* non-JSON user content is not an Agent envelope */ }
  }
  return envelope ? { ...envelope, ...(runtime ?? {}) } : null;
}

function latestEvidenceId(input: ModelCompletionRequest): string {
  const values: string[] = [];
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) collect(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === "evidenceId" && typeof item === "string") values.push(item);
      else if (key === "evidenceIds" && Array.isArray(item)) {
        values.push(...item.filter((entry): entry is string => typeof entry === "string"));
      } else collect(item);
    }
  };
  for (const message of input.messages.filter((item) => item.role === "tool")) {
    try { collect(JSON.parse(message.content ?? "{}")); } catch { /* malformed tool output is not evidence */ }
  }
  return values[values.length - 1] ?? "missing-evidence";
}

function startLocator() {
  return {
    locator: { version: 1, position: { kind: "epub_text", sectionIndex: 0, start: 0, end: 0 } },
    direction: "forward", maxChars: 500,
  };
}

async function waitForConversationTurn(
  app: INestApplication, token: string, conversationId: string, turnId: string,
): Promise<any> {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const row = app.get(SqliteService).getDatabase().prepare(
      "SELECT status FROM reading_conversation_turns WHERE id=? AND conversation_id=?",
    ).get(turnId, conversationId) as unknown as { status: string } | undefined;
    if (row && ["completed", "partial", "needs_input", "failed", "cancelled"].includes(row.status)) {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/ai-reading/conversations/${conversationId}/turns/${turnId}`)
        .set(sessionHeaders(token))
        .expect(200);
      return response.body.data;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const database = app.get(SqliteService).getDatabase();
  const task = database.prepare(
    "SELECT task_id,status FROM reading_conversation_turns WHERE id=? AND conversation_id=?",
  ).get(turnId, conversationId) as unknown as { task_id: string; status: string } | undefined;
  const runs = task ? database.prepare(
    `SELECT id,parent_run_id,depth,status,terminal_reason,checkpoint_version,lease_owner,lease_generation,
      lease_expires_at,json_extract(checkpoint_json,'$.nextStepNo') AS next_step_no,
      json_array_length(json_extract(checkpoint_json,'$.messages')) AS message_count,
      json_array_length(json_extract(checkpoint_json,'$.childResultIds')) AS child_result_count
      FROM ai_reading_agent_runs WHERE task_id=? ORDER BY depth,id`,
  ).all(task.task_id) : [];
  const steps = task ? database.prepare(
    "SELECT agent_run_id,step_no,kind,status FROM ai_reading_agent_steps WHERE task_id=? ORDER BY agent_run_id,step_no",
  ).all(task.task_id) : [];
  throw new Error(`Conversation turn did not reach a terminal state: ${JSON.stringify({ task, runs, steps })}`);
}

function rootGoal(input: ModelCompletionRequest): string | null {
  const content = input.messages.find((message) => message.role === "user")?.content;
  const match = content?.match(/^Goal: ([^\n]+)/);
  return match?.[1] ?? null;
}

function countRows(database: ReturnType<SqliteService["getDatabase"]>, table: string, taskId: string): number {
  const taskColumn = table === "ai_reading_tasks" ? "id" : "task_id";
  const row = database.prepare(`SELECT COUNT(1) AS total FROM ${table} WHERE ${taskColumn} = ?`)
    .get(taskId) as unknown as { total: number };
  return Number(row.total);
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function createApplication(fakeDeepSeek: FakeDeepSeek): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LanguageModelGateway)
    .useValue(fakeDeepSeek)
    .compile();
  const application = moduleRef.createNestApplication();
  application.useGlobalPipes(new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
  }));
  application.useGlobalFilters(new AllExceptionsFilter());
  application.useGlobalInterceptors(new SuccessResponseInterceptor());
  application.use((req: Request, res: Response, next: NextFunction) => {
    req.requestId = req.header("x-request-id") || randomUUID();
    res.setHeader("x-request-id", req.requestId);
    next();
  });
  await application.init();
  return application;
}

async function register(app: INestApplication, email: string): Promise<string> {
  const response = await request(app.getHttpServer())
    .post("/api/v1/auth/register")
    .set("Origin", "http://localhost:5173")
    .send({ email, password: "Password123!", confirmPassword: "Password123!" })
    .expect(201);
  return authCookie(response);
}

function createEpub(extraText = ""): Buffer {
  const zip = new AdmZip();
  zip.addFile("mimetype", Buffer.from("application/epub+zip"));
  zip.addFile("META-INF/container.xml", Buffer.from(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>
<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
</rootfiles></container>`));
  zip.addFile("OEBPS/content.opf", Buffer.from(`<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>AI 阅读测试书</dc:title><dc:creator>测试作者</dc:creator></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine><itemref idref="ch1"/></spine></package>`));
  zip.addFile("OEBPS/nav.xhtml", Buffer.from(`<!doctype html><html xmlns:epub="http://www.idpf.org/2007/ops"><body>
<nav epub:type="toc"><ol><li><a href="ch1.xhtml">第一章</a></li></ol></nav></body></html>`));
  zip.addFile("OEBPS/ch1.xhtml", Buffer.from(`<!doctype html><html><body><h1>第一章</h1>
<p>阅读必须以可核验证据为基础，并且每个结论都应能够返回原文。${extraText}</p></body></html>`));
  return zip.toBuffer();
}
