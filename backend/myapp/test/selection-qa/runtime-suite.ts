import { sessionHeaders } from "../auth-session.helper";
import { AttachBookFileUseCase } from "../../src/modules/intelligent-library/catalog/application/use-cases/attach-book-file.use-case";
import { createCompatApp } from "../compat-e2e.helper";
import {
  ScriptedQaModel,
  searchPlan,
  cacheAnswer,
  transferAnswer,
} from "./mock-model.fixture";
import { SELECTION_QA_MODEL_PORT } from "../../src/modules/ai-reading/selection-qa/application/selection-qa-runtime.port";
import { SqliteService } from "../../src/platform/persistence/sqlite/sqlite.service";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSelectionQaFixture,
  qaRequest,
  waitForTurn,
  terminalMetrics,
} from "./http-fixture";
import {
  selectedText,
  searchEvidence,
  selfAuthoredEpub,
} from "./self-authored-epub";

describe("selection QA real Nest, SQLite and EPUB (isolated)", () => {
  const model = new ScriptedQaModel();
  let peakRss = process.memoryUsage().rss;
  const rssTimer = setInterval(
    () => (peakRss = Math.max(peakRss, process.memoryUsage().rss)),
    10,
  );
  const metrics: {
    cancelConfirmationMs: number | null;
    providerAbortMs: number | null;
    citationReplaySuccesses: number;
    claimSupportChecks: Array<Record<string, unknown>>;
  } = {
    cancelConfirmationMs: null,
    providerAbortMs: null,
    citationReplaySuccesses: 0,
    claimSupportChecks: [],
  };
  let cited: { turnId: string; evidenceId: string };
  let root: string,
    fixture: Awaited<ReturnType<typeof createSelectionQaFixture>>;
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "rew-qa-e2e-"));
    fixture = await createSelectionQaFixture(root, [
      { token: SELECTION_QA_MODEL_PORT, value: model },
    ]);
    await fixture.app.listen(0, "127.0.0.1");
  });
  afterAll(async () => {
    if (fixture) {
      const db = fixture.app.get(SqliteService).getDatabase();
      const indexes = db
        .prepare(
          "SELECT state,updated_at-created_at buildMs FROM content_index_generations",
        )
        .all();
      const turns = [...terminalMetrics.values()];
      const report = {
        mode: "scripted mock; not real model quality",
        node: process.version,
        peakRssMiB: peakRss / 1048576,
        ...metrics,
        indexes,
        turns,
        terminalDistribution: Object.fromEntries(
          ["completed", "cancelled", "failed", "timed_out"].map((status) => [
            status,
            turns.filter((t) => t.status === status).length,
          ]),
        ),
      };
      const reportPath = join(tmpdir(), `rew-qa-runtime-${process.pid}.json`);
      writeFileSync(reportPath, JSON.stringify(report, null, 2));
      console.log(
        "SELECTION_QA_METRICS " + JSON.stringify({ reportPath, ...report }),
      );
      await fixture.app.close();
    }
    clearInterval(rssTimer);
    rmSync(root, { recursive: true, force: true });
  });
  it("resolves an authored full CFI from imported bytes and rejects a different user or revision", async () => {
    const { app, auth, other, selection, bookId } = fixture;
    const resolved = await qaRequest(
      app,
      auth.sessionCookie,
      "post",
      "/selections/resolve",
    )
      .send({ bookId, selection })
      .expect(201);
    expect(resolved.body.data.canonicalQuote).toBe(selectedText);
    expect(resolved.body.data.start).toBe(0);
    expect(resolved.body.data.end).toBe(selectedText.length);
    await qaRequest(app, other.sessionCookie, "post", "/selections/resolve")
      .send({ bookId, selection })
      .expect(404);
    const stale = await qaRequest(
      app,
      auth.sessionCookie,
      "post",
      "/selections/resolve",
    )
      .send({
        bookId,
        selection: {
          ...selection,
          scope: {
            ...selection.scope,
            fileChecksum: "sha256:" + "0".repeat(64),
          },
        },
      })
      .expect(409);
    expect(stale.body.details.reason).toBe("CONTENT_REVISION_MISMATCH");
  });
  it("explains without a profile, preserves three follow-ups and uses durable SSE replay", async () => {
    const { app, auth, bookId, selection } = fixture;
    model.use();
    const created = await qaRequest(
      app,
      auth.sessionCookie,
      "post",
      "/conversations",
    )
      .send({
        bookId,
        selection,
        question: "解释这段话",
        commandId: randomUUID(),
      })
      .expect(201);
    const conversation = created.body.data.conversation,
      first = created.body.data.turn;
    const terminal = await waitForTurn(
      app,
      auth.sessionCookie,
      conversation.id,
      first.id,
    );
    expect(terminal.status).toBe("completed");
    expect(terminal.answer).toContain("隔离模型");
    const db = app.get(SqliteService).getDatabase();
    expect(
      db
        .prepare(
          "SELECT COUNT(*) n FROM book_profiles WHERE book_id=? AND (primary_genre IS NOT NULL OR classification_summary IS NOT NULL)",
        )
        .get(bookId)!.n,
    ).toBe(0);
    expect(
      db
        .prepare(
          "SELECT COUNT(*) n FROM content_index_generations WHERE book_id=?",
        )
        .get(bookId)!.n,
    ).toBe(0);
    for (let i = 0; i < 3; i++) {
      model.use();
      const next = await qaRequest(
        app,
        auth.sessionCookie,
        "post",
        `/conversations/${conversation.id}/turns`,
      )
        .send({ question: `追问${i + 1}`, commandId: randomUUID() })
        .expect(201);
      expect(
        (
          await waitForTurn(
            app,
            auth.sessionCookie,
            conversation.id,
            next.body.data.id,
          )
        ).status,
      ).toBe("completed");
    }
    const page = await qaRequest(
      app,
      auth.sessionCookie,
      "get",
      `/conversations/${conversation.id}/turns`,
    ).expect(200);
    expect(page.body.data.items).toHaveLength(4);
    const events = await qaRequest(
      app,
      auth.sessionCookie,
      "get",
      `/turns/${first.id}/events?afterSequence=0`,
    ).expect(200);
    expect(events.text).toContain("event: answer_delta");
    expect(events.text).toContain("event: terminal");
    const all = events.text
      .split("\n")
      .filter((line: string) => line.startsWith("data: "))
      .map((line: string) => JSON.parse(line.slice(6)));
    const originalCitation = all.find(
      (event: { kind: string }) => event.kind === "citation",
    ).data.evidence;
    expect(originalCitation.quote).toContain(selectedText);
    expect(terminal.answer).toContain(cacheAnswer);
    metrics.claimSupportChecks.push({
      case: "cache-explain",
      claim: cacheAnswer,
      gold: selectedText,
      passed: true,
    });
    const after = all[Math.floor(all.length / 2)].sequence;
    const resumed = await qaRequest(
      app,
      auth.sessionCookie,
      "get",
      `/turns/${first.id}/events?afterSequence=${after}`,
    ).expect(200);
    const replay = resumed.text
      .split("\n")
      .filter((line: string) => line.startsWith("data: "))
      .map((line: string) => JSON.parse(line.slice(6)));
    expect(replay.map((event: { sequence: number }) => event.sequence)).toEqual(
      all
        .filter((event: { sequence: number }) => event.sequence > after)
        .map((event: { sequence: number }) => event.sequence),
    );
  });
  it("builds real FTS on first retrieval and cites current EPUB ranges", async () => {
    const { app, auth, bookId, selection } = fixture;
    model.use({ plans: [[searchPlan], []] });
    const response = await qaRequest(
      app,
      auth.sessionCookie,
      "post",
      "/conversations",
    )
      .send({
        bookId,
        selection,
        question: "在全书中查找事务原子性与转账的关系",
        commandId: randomUUID(),
      })
      .expect(201);
    const { conversation, turn } = response.body.data;
    const completed = await waitForTurn(
      app,
      auth.sessionCookie,
      conversation.id,
      turn.id,
    );
    expect({
      errorCode: completed.errorCode,
      indexError: app
        .get(SqliteService)
        .getDatabase()
        .prepare(
          "SELECT error FROM content_index_generations WHERE book_id=? ORDER BY rowid DESC LIMIT 1",
        )
        .get(bookId)?.error,
    }).toEqual({ errorCode: null, indexError: null });
    expect(completed.status).toBe("completed");
    const db = app.get(SqliteService).getDatabase();
    expect(
      db
        .prepare(
          "SELECT COUNT(*) n FROM content_index_generations WHERE book_id=? AND state='ready'",
        )
        .get(bookId)!.n,
    ).toBe(1);
    expect(model.calls.filter((c) => c.kind === "complete")).toHaveLength(3);
    const events = await qaRequest(
      app,
      auth.sessionCookie,
      "get",
      `/turns/${turn.id}/events`,
    ).expect(200);
    expect(events.text).toContain("event: citation");
    const citation = events.text
      .split("\n")
      .filter((line: string) => line.startsWith("data: "))
      .map((line: string) => JSON.parse(line.slice(6)))
      .find((event: { kind: string }) => event.kind === "citation")
      .data.evidence;
    cited = { turnId: turn.id, evidenceId: citation.evidenceId };
    expect(citation.sectionIndex).toBe(1);
    expect(citation.quote).toContain(searchEvidence);
    expect(completed.answer).toContain(transferAnswer);
    metrics.claimSupportChecks.push({
      case: "transfer-search",
      claim: transferAnswer,
      gold: searchEvidence,
      passed: true,
    });
    const location = await qaRequest(
      app,
      auth.sessionCookie,
      "get",
      `/turns/${turn.id}/evidence/${citation.evidenceId}/location`,
    ).expect(200);
    expect(location.body.data.scope.bookId).toBe(bookId);
    expect(location.body.data.cfi).toBe(citation.cfi);
    metrics.citationReplaySuccesses++;
    await qaRequest(
      app,
      fixture.other.sessionCookie,
      "get",
      `/turns/${turn.id}/evidence/${citation.evidenceId}/location`,
    ).expect(404);
    await qaRequest(
      app,
      auth.sessionCookie,
      "get",
      `/turns/${turn.id}/evidence/forged/location`,
    ).expect(404);
  });
  it("keeps partial text on stop and on a provider failure", async () => {
    const { app, auth, bookId, selection } = fixture;
    let started!: () => void;
    const streaming = new Promise<void>((r) => (started = r));
    model.use({ hold: new Promise<void>(() => {}), onStream: started });
    const response = await qaRequest(
      app,
      auth.sessionCookie,
      "post",
      "/conversations",
    )
      .send({
        bookId,
        selection,
        question: "可以停止的解释",
        commandId: randomUUID(),
      })
      .expect(201);
    const { conversation, turn } = response.body.data;
    await streaming;
    const stopStart = performance.now();
    await qaRequest(app, auth.sessionCookie, "post", `/turns/${turn.id}/stop`)
      .send({})
      .expect(201);
    metrics.cancelConfirmationMs = performance.now() - stopStart;
    const stopped = await waitForTurn(
      app,
      auth.sessionCookie,
      conversation.id,
      turn.id,
    );
    expect(stopped.status).toBe("cancelled");
    expect(stopped.answer).toContain("隔离模型");
    const streamSignal = model.calls.find((c) => c.kind === "stream")!.input
      .signal;
    const abortDeadline = Date.now() + 3000;
    while (!streamSignal.aborted && Date.now() < abortDeadline)
      await new Promise((r) => setTimeout(r, 10));
    expect(streamSignal.aborted).toBe(true);
    metrics.providerAbortMs = performance.now() - stopStart;
    model.use({ failAfterFirstDelta: true });
    const failedResponse = await qaRequest(
      app,
      auth.sessionCookie,
      "post",
      "/conversations",
    )
      .send({
        bookId,
        selection,
        question: "中途出错的解释",
        commandId: randomUUID(),
      })
      .expect(201);
    const failed = await waitForTurn(
      app,
      auth.sessionCookie,
      failedResponse.body.data.conversation.id,
      failedResponse.body.data.turn.id,
    );
    expect(failed.status).toBe("failed");
    expect(failed.answer).toContain("隔离模型");
  });
  it("continues generation after SSE closes and rejects forged citation IDs", async () => {
    const { app, auth, bookId, selection } = fixture;
    model.use({ delayMs: 250 });
    const response = await qaRequest(
      app,
      auth.sessionCookie,
      "post",
      "/conversations",
    )
      .send({
        bookId,
        selection,
        question: "断开连接继续生成",
        commandId: randomUUID(),
      })
      .expect(201);
    const { conversation, turn } = response.body.data;
    const stream = await fetch(
      `${await app.getUrl()}/api/v1/selection-qa/turns/${turn.id}/events`,
      { headers: { ...sessionHeaders(auth.sessionCookie), "X-Selection-QA-Protocol": "2" } },
    );
    expect(stream.status).toBe(200);
    const reader = stream.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    await reader.cancel();
    expect(
      (await waitForTurn(app, auth.sessionCookie, conversation.id, turn.id))
        .status,
    ).toBe("completed");
    model.use({ fakeCitation: true });
    const forgedResponse = await qaRequest(
      app,
      auth.sessionCookie,
      "post",
      "/conversations",
    )
      .send({
        bookId,
        selection,
        question: "不能接受伪引用",
        commandId: randomUUID(),
      })
      .expect(201);
    const forged = await waitForTurn(
      app,
      auth.sessionCookie,
      forgedResponse.body.data.conversation.id,
      forgedResponse.body.data.turn.id,
    );
    expect(forged.status).toBe("failed");
    const events = await qaRequest(
      app,
      auth.sessionCookie,
      "get",
      `/turns/${forged.id}/events`,
    ).expect(200);
    expect(events.text).not.toContain('"evidenceId":"forged-id"');
  });
  it("persists apply receipts, enforces annotation CAS, and keeps receipts after conversation deletion", async () => {
    const { app, auth, bookId, selection } = fixture;
    model.use();
    const created = await qaRequest(
      app,
      auth.sessionCookie,
      "post",
      "/conversations",
    )
      .send({
        bookId,
        selection,
        question: "解释后追加批注",
        commandId: randomUUID(),
      })
      .expect(201);
    const { conversation, turn } = created.body.data;
    const applicable = await waitForTurn(app, auth.sessionCookie, conversation.id, turn.id);
    const create = {
      commandId: randomUUID(),
      appendText: "人工预览确认的答复",
      answerVersion: applicable.answerVersion,
      target: {
        kind: "create",
        annotationType: "highlight",
        color: "#ffff00",
        cfi: selection.cfi,
      },
    };
    const applied = await qaRequest(
      app,
      auth.sessionCookie,
      "post",
      `/turns/${turn.id}/apply-annotation`,
    )
      .send(create)
      .expect(201);
    const annotation = applied.body.data.receipt.annotation;
    const append = {
      commandId: randomUUID(),
      appendText: "第二段确认文字",
      answerVersion: applicable.answerVersion,
      target: {
        kind: "append",
        annotationId: annotation.id,
        expectedRevision: annotation.revision,
      },
    };
    await qaRequest(
      app,
      auth.sessionCookie,
      "post",
      `/turns/${turn.id}/apply-annotation`,
    )
      .send(append)
      .expect(201);
    await qaRequest(
      app,
      auth.sessionCookie,
      "post",
      `/turns/${turn.id}/apply-annotation`,
    )
      .send({ ...append, commandId: randomUUID() })
      .expect(409);
    await qaRequest(
      app,
      auth.sessionCookie,
      "delete",
      `/conversations/${conversation.id}`,
    ).expect(200);
    const replayed = await qaRequest(
      app,
      auth.sessionCookie,
      "post",
      `/turns/${turn.id}/apply-annotation`,
    )
      .send(create)
      .expect(201);
    expect(replayed.body.data.replayed).toBe(true);
    expect(replayed.body.data.receipt).toEqual(applied.body.data.receipt);
    expect(replayed.body.data.currentAnnotation.note).toContain(
      "第二段确认文字",
    );
  });

  it("uses five model calls on the normal two-search path including streaming and checking", async () => {
    const { app, auth, bookId, selection } = fixture;
    model.use({
      plans: Array.from({ length: 2 }, (_, i) => [
        { ...searchPlan, id: `repeat-${i}` },
      ]),
    });
    const response = await qaRequest(
      app,
      auth.sessionCookie,
      "post",
      "/conversations",
    )
      .send({
        bookId,
        selection,
        question: "反复检索也必须遵守预算",
        commandId: randomUUID(),
      })
      .expect(201);
    const { conversation, turn } = response.body.data;
    const terminal = await waitForTurn(
      app,
      auth.sessionCookie,
      conversation.id,
      turn.id,
    );
    expect(terminal.status).toBe("completed");
    expect(model.calls.map((c) => c.kind)).toEqual([
      "complete",
      "complete",
      "complete",
      "stream",
      "complete",
    ]);
    expect(
      app
        .get(SqliteService)
        .getDatabase()
        .prepare("SELECT model_call_count FROM selection_qa_turns WHERE id=?")
        .get(turn.id)!.model_call_count,
    ).toBe(5);
  });
  it("persists two protocol repairs without consuming the reserved final stream", async () => {
    const { app, auth, bookId, selection } = fixture;
    const invalidFinish = (id: string) => ({
      id,
      name: "finish_research",
      arguments: JSON.stringify({ informationNeeds: [], selectedEvidenceIds: [] }),
    });
    model.use({
      plans: [
        [{ ...searchPlan, id: "repair-search-1" }],
        [{ ...searchPlan, id: "repair-search-2" }],
        [invalidFinish("invalid-finish")],
        [invalidFinish("invalid-repair")],
      ],
    });
    const response = await qaRequest(app, auth.sessionCookie, "post", "/conversations")
      .send({ bookId, selection, question: "检索后允许修正工具参数", commandId: randomUUID() })
      .expect(201);
    const { conversation, turn } = response.body.data;
    const terminal = await waitForTurn(app, auth.sessionCookie, conversation.id, turn.id);
    expect(terminal.status).toBe("completed");
    expect(model.calls.map((call) => call.kind)).toEqual([
      "complete", "complete", "complete", "complete", "complete", "stream", "complete",
    ]);
    const counters = app.get(SqliteService).getDatabase()
      .prepare("SELECT model_call_count FROM selection_qa_turns WHERE id=?")
      .get(turn.id);
    expect(counters).toEqual({ model_call_count: 7 });
  });
  it("enforces a persisted expired deadline without discarding streamed text", async () => {
    const { app, auth, bookId, selection } = fixture;
    let started!: () => void;
    const streaming = new Promise<void>((r) => (started = r));
    model.use({ hold: new Promise<void>(() => {}), onStream: started });
    const response = await qaRequest(
      app,
      auth.sessionCookie,
      "post",
      "/conversations",
    )
      .send({
        bookId,
        selection,
        question: "验证已到期的持久期限",
        commandId: randomUUID(),
      })
      .expect(201);
    const { conversation, turn } = response.body.data;
    await streaming;
    /* Isolated fault injection: advance only this persisted deadline, not production policy. */ app
      .get(SqliteService)
      .getDatabase()
      .prepare("UPDATE selection_qa_turns SET deadline=? WHERE id=?")
      .run(Date.now() - 1, turn.id);
    const terminal = await waitForTurn(
      app,
      auth.sessionCookie,
      conversation.id,
      turn.id,
    );
    expect(terminal.status).toBe("timed_out");
    expect(terminal.errorCode).toBe("DEADLINE_EXCEEDED");
    expect(terminal.answer).toContain("隔离模型");
  });
  it("reopens persistent conversations without regenerating completed turns", async () => {
    const { app, auth, bookId, selection } = fixture;
    model.use();
    const response = await qaRequest(
      app,
      auth.sessionCookie,
      "post",
      "/conversations",
    )
      .send({
        bookId,
        selection,
        question: "重启后保留这条回答",
        commandId: randomUUID(),
      })
      .expect(201);
    const { conversation, turn } = response.body.data;
    const before = await waitForTurn(
      app,
      auth.sessionCookie,
      conversation.id,
      turn.id,
    );
    let slowStarted!: () => void;
    const slowStreaming = new Promise<void>((r) => (slowStarted = r));
    model.use({ hold: new Promise<void>(() => {}), onStream: slowStarted });
    const slow = await qaRequest(
      app,
      auth.sessionCookie,
      "post",
      "/conversations",
    )
      .send({
        bookId,
        selection,
        question: "停机时保留慢流",
        commandId: randomUUID(),
      })
      .expect(201);
    await slowStreaming;
    const slowSignal = model.calls.find((c) => c.kind === "stream")!.input
      .signal;
    await app.close();
    expect(slowSignal.aborted).toBe(true);
    model.use();
    fixture.app = await createCompatApp(root, [
      { token: SELECTION_QA_MODEL_PORT, value: model },
    ]);
    await fixture.app.listen(0, "127.0.0.1");
    const page = await qaRequest(
      fixture.app,
      auth.sessionCookie,
      "get",
      `/conversations/${conversation.id}/turns`,
    ).expect(200);
    expect(
      page.body.data.items.find((t: { id: string }) => t.id === turn.id),
    ).toEqual(before);
    await new Promise((r) => setTimeout(r, 100));
    expect(model.calls).toHaveLength(0);
    const interrupted = await waitForTurn(
      fixture.app,
      auth.sessionCookie,
      slow.body.data.conversation.id,
      slow.body.data.turn.id,
    );
    expect(interrupted.status).toBe("failed");
    expect(interrupted.errorCode).toBe("worker_interrupted");
    expect(interrupted.answer).toContain("隔离模型");
  });

  it("rejects tool attempts to add a cross-book scope", async () => {
    const { app, auth, bookId, selection } = fixture;
    model.use({
      plans: [
        [
          {
            id: "invalid-scope",
            name: "search_book",
            arguments: JSON.stringify({
              bookId: bookId + 1,
              informationNeed: "cross-book attempt",
              queries: { query1: "test", query2: "", query3: "", query4: "" },
            }),
          },
        ],
      ],
    });
    const response = await qaRequest(
      app,
      auth.sessionCookie,
      "post",
      "/conversations",
    )
      .send({
        bookId,
        selection,
        question: "不允许跨书读取",
        commandId: randomUUID(),
      })
      .expect(201);
    const { conversation, turn } = response.body.data;
    const terminal = await waitForTurn(
      app,
      auth.sessionCookie,
      conversation.id,
      turn.id,
    );
    expect(terminal.status).toBe("failed");
    expect(terminal.errorCode).toBe("TOOL_SCOPE_VIOLATION");
    expect(model.calls.filter((c) => c.kind === "stream")).toHaveLength(0);
  });
  it("freezes an active conversation when Catalog publishes replacement bytes", async () => {
    const { app, auth, other, bookId, selection } = fixture;
    let started!: () => void;
    const streaming = new Promise<void>((r) => (started = r));
    model.use({ hold: new Promise<void>(() => {}), onStream: started });
    const response = await qaRequest(
      app,
      auth.sessionCookie,
      "post",
      "/conversations",
    )
      .send({
        bookId,
        selection,
        question: "文件切换期间的生成",
        commandId: randomUUID(),
      })
      .expect(201);
    const { conversation, turn } = response.body.data;
    await streaming;
    await qaRequest(
      app,
      other.sessionCookie,
      "get",
      `/conversations/${conversation.id}`,
    ).expect(404);
    const replacement = selfAuthoredEpub("替换版本", true);
    const userId = Number(
      app
        .get(SqliteService)
        .getDatabase()
        .prepare("SELECT user_id FROM books WHERE id=?")
        .get(bookId)!.user_id,
    );
    await app.get(AttachBookFileUseCase).execute({
      userId,
      bookId,
      content: replacement.bytes,
      sourcePlatform: null,
      sourceUrl: null,
      fileName: "replacement.epub",
      mimeType: "application/epub+zip",
      fileSize: replacement.bytes.length,
      checksum: replacement.checksum.slice(7),
    });
    const frozen = await qaRequest(
      app,
      auth.sessionCookie,
      "get",
      `/conversations/${conversation.id}`,
    ).expect(200);
    expect(frozen.body.data.status).toBe("frozen");
    await qaRequest(
      app,
      auth.sessionCookie,
      "get",
      `/conversations/${conversation.id}/location`,
    ).expect(409);
    expect(cited).toBeDefined();
    await qaRequest(
      app,
      auth.sessionCookie,
      "get",
      `/turns/${cited.turnId}/evidence/${cited.evidenceId}/location`,
    ).expect(409);
    const terminal = await waitForTurn(
      app,
      auth.sessionCookie,
      conversation.id,
      turn.id,
    );
    expect(terminal.status).toBe("failed");
    expect(terminal.errorCode).toBe("CONTENT_VERSION_CHANGED");
    await qaRequest(
      app,
      auth.sessionCookie,
      "post",
      `/conversations/${conversation.id}/turns`,
    )
      .send({ question: "旧版本继续", commandId: randomUUID() })
      .expect(409);
    await qaRequest(app, auth.sessionCookie, "post", "/selections/resolve")
      .send({ bookId, selection })
      .expect(409);
  });
});
