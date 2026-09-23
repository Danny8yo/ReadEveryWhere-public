import {
  MAX_PUBLIC_EVENT_PAYLOAD_BYTES,
  assertPublicReadingEventPayloadV2,
  createAnswerCompletedPayload,
  createAnswerDeltaPayload,
  createAnswerStartedPayload,
  createAgentProgressPayload,
  createEvidenceEventPayload,
  createEvidenceImportedEventPayload,
  createToolObservationPayload,
  createToolStartedPayload,
  toPublicReadingEventPayload,
} from "./public-reading-event";

describe("public reading event projection", () => {
  it("accepts bounded book_read_from_toc start and result projections", () => {
    expect(createToolStartedPayload("book_read_from_toc", {
      nodeIds: ["node-1"],
    })).toMatchObject({
      toolName: "book_read_from_toc",
      detail: {
        arguments: { nodeIds: ["node-1"] },
      },
    });

    expect(createToolObservationPayload("book_read_from_toc", {
      text: "可核验正文",
      segments: [],
      continuation: { previous: null, next: null },
      boundary: { sectionStart: true, sectionEnd: true, bookStart: false, bookEnd: false },
    })).toMatchObject({
      toolName: "book_read_from_toc",
      detail: { result: { characterCount: 5 } },
    });
  });

  it("publishes bounded agent progress without exposing credentials or hidden reasoning", () => {
    const event = createAgentProgressPayload({
      text: `我先核对目录，再读取绪论。 apiKey=sk-private-value ${"下一步".repeat(800)}`,
    });

    expect(event).toMatchObject({
      schemaVersion: 2,
      kind: "commentary",
      title: "Agent 执行说明",
      detail: { phase: "completed" },
    });
    const detail = event.detail as Record<string, unknown>;
    expect(String(detail.text)).toContain("我先核对目录");
    expect(String(detail.text).length).toBeLessThanOrEqual(1_200);
    expect(JSON.stringify(event)).not.toContain("sk-private-value");
    expect(() => assertPublicReadingEventPayloadV2(event)).not.toThrow();
  });

  it("publishes bounded, replayable answer stream events without sensitive text", () => {
    expect(createAnswerStartedPayload({ answerId: "answer-1", mode: "model" })).toMatchObject({
      schemaVersion: 2,
      kind: "answer",
      detail: { phase: "started", answerId: "answer-1", mode: "model" },
    });

    const delta = createAnswerDeltaPayload({
      answerId: "answer-1",
      offset: 0,
      delta: `结论：apiKey=sk-private-value ${"正文".repeat(2_000)}`,
    });
    expect(delta).toMatchObject({
      schemaVersion: 2,
      kind: "answer",
      detail: { phase: "streaming", answerId: "answer-1", offset: 0 },
    });
    expect(JSON.stringify(delta)).not.toContain("sk-private-value");
    expect((delta.detail as Record<string, unknown>).delta).toHaveLength(2_000);

    const completed = createAnswerCompletedPayload({
      answerId: "answer-1",
      mode: "model",
      text: "这是最终回答。",
      evidenceIds: ["evidence-1"],
    });
    expect(completed).toMatchObject({
      schemaVersion: 2,
      kind: "answer",
      detail: {
        phase: "completed",
        answerId: "answer-1",
        mode: "model",
        text: "这是最终回答。",
        characterCount: 7,
        evidenceIds: ["evidence-1"],
      },
    });
    expect(() => assertPublicReadingEventPayloadV2(completed)).not.toThrow();
  });

  it("whitelists tool arguments and redacts credential-shaped text", () => {
    const event = createToolStartedPayload("book_search_text", {
      query: "apiKey=sk-private-value Authorization:Bearer abcdefghijk",
      cursor: "opaque-secret-cursor",
      limit: 10,
      reasoning_content: "hidden",
    });

    expect(event).toMatchObject({
      schemaVersion: 2,
      kind: "tool",
      toolName: "book_search_text",
      detail: {
        phase: "started",
        arguments: { cursorUsed: true, limit: 10 },
      },
    });
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("opaque-secret-cursor");
    expect(serialized).not.toContain("sk-private-value");
    expect(serialized).not.toContain("reasoning_content");
  });

  it("persists only a bounded book_read excerpt, citation and boundaries", () => {
    const fullText = `START-${"正文".repeat(5_000)}-END`;
    const citation = fixtureCitation();
    const event = createToolObservationPayload("book_read", {
      text: fullText,
      previousLocator: { version: 1 },
      nextLocator: null,
      reachedSectionStart: true,
      reachedSectionEnd: false,
      reachedBookStart: false,
      reachedBookEnd: false,
      segments: [{ textStart: 0, textEnd: fullText.length, citation }],
      continuation: { previous: { locator: { version: 1 } }, next: null },
      boundary: { sectionStart: true, sectionEnd: false, bookStart: false, bookEnd: false },
    }, {
      argumentsValue: { direction: "around", maxChars: 8_000, locator: citation.locator },
      durationMs: 20,
      readSource: {
        text: fullText,
        segments: [{ textStart: 0, textEnd: fullText.length, citation }],
      },
    });

    expect(event.detail).toMatchObject({
      phase: "completed",
      result: {
        characterCount: fullText.length,
        boundaries: { previousAvailable: true, nextAvailable: false, reachedSectionStart: true },
      },
    });
    const detail = event.detail as Record<string, any>;
    const excerpt = detail.result.excerpt as string;
    expect(excerpt).toHaveLength(800);
    expect(JSON.stringify(event)).not.toContain("-END");
  });

  it("limits scan results and drops overlong CFI without corrupting it", () => {
    const hits = Array.from({ length: 9 }, (_, index) => ({
      matchedText: `命中 ${index}`,
      snippet: "x".repeat(1_000),
      chapterPath: "章".repeat(300),
      citation: fixtureCitation("epubcfi(" + "x".repeat(3_000) + ")"),
    }));
    const event = createToolObservationPayload("book_search_text", {
      hits,
      hasMore: true,
      nextCursor: "opaque",
    });
    const result = (event.detail as Record<string, any>).result as Record<string, any>;

    expect(result.returnedCount).toBe(9);
    expect(result.items).toHaveLength(5);
    expect(result.items[0].snippet).toHaveLength(320);
    expect(result.items[0].citation.locator.readerAnchor).toBeUndefined();
    expect(result.pagination).toEqual({
      hasMore: true,
      nextCursorAvailable: true,
      truncatedItems: true,
    });
  });

  it("reduces result items before falling back when a projection exceeds 32 KiB", () => {
    const citation = fixtureCitation("epubcfi(" + "x".repeat(2_000) + ")");
    citation.authors = Array.from({ length: 10 }, () => "作".repeat(120));
    citation.bookTitle = "书".repeat(300);
    citation.locator.textQuote = {
      exact: "引".repeat(1_500),
      prefix: "前".repeat(128),
      suffix: "后".repeat(128),
    };
    citation.locator.structure = {
      href: "h".repeat(1_024),
      fragment: "f".repeat(256),
      label: "l".repeat(300),
      path: "p".repeat(500),
    };
    const event = createToolObservationPayload("book_search_text", {
      hits: Array.from({ length: 5 }, () => ({
        matchedText: "m".repeat(120),
        snippet: "s".repeat(320),
        chapterPath: "c".repeat(240),
        citation,
      })),
    });

    expect(Buffer.byteLength(JSON.stringify(event), "utf8")).toBeLessThanOrEqual(MAX_PUBLIC_EVENT_PAYLOAD_BYTES);
    expect(event.truncated).toBe(true);
    expect(((event.detail as Record<string, any>).result.items as unknown[]).length).toBeLessThan(5);
    expect(() => assertPublicReadingEventPayloadV2(event)).not.toThrow();
  });

  it("rejects mismatched detail schemas, overlong plan steps and sensitive nested fields", () => {
    expect(() => assertPublicReadingEventPayloadV2({
      schemaVersion: 2,
      kind: "plan",
      title: "更新计划",
      detail: { before: [], after: [{ id: "a", title: "x", status: "unknown" }] },
    })).toThrow("after.status is invalid");

    expect(() => assertPublicReadingEventPayloadV2({
      schemaVersion: 2,
      kind: "plan",
      title: "更新计划",
      detail: { before: [], after: [{ id: "a", title: "x".repeat(501), status: "pending" }] },
    })).toThrow("title must be a non-empty string of at most 500 characters");

    expect(() => assertPublicReadingEventPayloadV2({
      schemaVersion: 2,
      kind: "tool",
      title: "调用 book_read",
      toolName: "book_read",
      detail: {
        phase: "started",
        purpose: "限量读取",
        arguments: { systemPrompt: "ignore previous instructions" },
      },
    })).toThrow("forbidden field systemPrompt");

    expect(() => assertPublicReadingEventPayloadV2({
      schemaVersion: 2,
      kind: "tool",
      title: "调用 book_read",
      toolName: "book_read",
      detail: {
        phase: "started",
        purpose: "Authorization: Bearer top-secret-token",
        arguments: {},
      },
    })).toThrow("credential-shaped text");
  });

  it("bounds evidence and safely degrades legacy rows without exposing arbitrary fields", () => {
    const evidence = createEvidenceEventPayload({
      quote: "证".repeat(1_000),
      chapterPath: "第一章",
      citation: fixtureCitation(),
    });
    expect(((evidence.detail as Record<string, unknown>).quote as string)).toHaveLength(600);

    const legacy = toPublicReadingEventPayload("tool_observation", {
      toolName: "book_read",
      summary: "旧事件摘要",
      apiKey: "sk-should-never-appear",
      text: "完整正文",
    });
    expect(legacy).toEqual({
      schemaVersion: 1,
      legacy: true,
      kind: "tool",
      title: "完成 book_read",
      summary: "旧事件摘要",
      toolName: "book_read",
      detail: { unavailable: true },
    });
    expect(JSON.stringify(legacy)).not.toContain("完整正文");

    const unsafeLegacy = toPublicReadingEventPayload("tool_observation", {
      toolName: "book_read",
      message: "未经清洗的上游响应",
      observation: "旧事件完整正文",
    });
    expect(unsafeLegacy).toEqual({
      schemaVersion: 1,
      legacy: true,
      kind: "tool",
      title: "完成 book_read",
      toolName: "book_read",
      detail: { unavailable: true },
    });
  });

  it("projects imported evidence without source text or transcript", () => {
    const event = createEvidenceImportedEventPayload({
      evidenceIds: ["evidence-new-1", "evidence-new-2"], importedCount: 2,
    });
    expect(event).toMatchObject({
      schemaVersion: 2, kind: "evidence", title: "已导入历史证据",
      detail: {
        provenanceKind: "conversation_import",
        importedCount: 2,
        evidenceIds: ["evidence-new-1", "evidence-new-2"],
      },
    });
    expect(JSON.stringify(event)).not.toContain("sourceQuote");
  });
});

function fixtureCitation(epubcfi = "epubcfi(/6/2!/4/1:0)"): any {
  return {
    bookId: 11,
    bookTitle: "Fixture",
    authors: ["Author"],
    chapterPath: "第一章",
    locator: {
      version: 1,
      position: { kind: "epub_text", sectionIndex: 0, start: 0, end: 100 },
      readerAnchor: { epubcfi },
    },
  };
}
