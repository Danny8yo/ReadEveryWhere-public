import {
  childAgentTools,
  conversationAgentTools,
  parseToolArguments,
  parseToolArgumentsWithDiagnostics,
  recursiveChildAgentTools,
  rootAgentTools,
  toolArgumentIssues,
} from "./agent-tool.schemas";
import { estimateTokens } from "./context-window";

describe("agent tool schemas", () => {
  it("exports DeepSeek strict schemas with every object property required", () => {
    for (const tool of [...rootAgentTools, ...childAgentTools]) {
      expectEveryObjectPropertyRequired(tool.function.parameters);
    }

    const bookToc = rootAgentTools.find((tool) => tool.function.name === "book_toc")!;
    expect(bookToc.function.parameters).toMatchObject({
      required: ["cursor", "limit"],
      properties: {
        cursor: { anyOf: expect.arrayContaining([{ type: "null" }]) },
        limit: { anyOf: expect.arrayContaining([{ type: "null" }]) },
      },
    });
  });

  it("exports strict JSON Schemas without trusted scope parameters", () => {
    for (const tool of rootAgentTools) {
      expect(tool.function.parameters).toMatchObject({
        type: "object",
        additionalProperties: false,
      });
      const properties = (tool.function.parameters.properties ?? {}) as Record<string, unknown>;
      expect(properties).not.toHaveProperty("userId");
      expect(properties).not.toHaveProperty("bookId");
      expect(properties).not.toHaveProperty("contentRevision");
      expect(JSON.stringify(tool.function.parameters)).not.toMatch(/userId|bookId|contentRevision/);
    }
  });

  it("accepts model-facing locators without trusted scope and rejects injected scope", () => {
    const locator = {
      version: 1,
      position: { kind: "epub_text", sectionIndex: 2, start: 10, end: 20 },
      textQuote: { exact: "evidence" },
    };

    expect(parseToolArguments("book_read", { locator })).toMatchObject({ locator });
    expect(() => parseToolArguments("book_read", {
      locator: {
        ...locator,
        bookId: 999,
        contentRevision: {
          fileChecksum: "attacker-controlled",
          extractorVersion: "1",
          normalizationVersion: "1",
        },
      },
    })).toThrow();
  });

  it("rejects inverted ranges in both full and minimum locators", () => {
    const invertedPosition = {
      kind: "epub_text" as const,
      sectionIndex: 2,
      start: 20,
      end: 10,
    };

    expect(() => parseToolArguments("book_read", {
      locator: { version: 1, position: invertedPosition },
    })).toThrow();
    expect(() => parseToolArguments("book_read", {
      locator: {
        version: 1,
        position: { kind: "epub_text", sectionIndex: 2, start: 0, end: 0 },
      },
      endLocator: { version: 1, position: invertedPosition },
    })).toThrow();
  });

  it("rejects endLocator for around reads before invoking a reader tool", () => {
    const locator = {
      version: 1 as const,
      position: { kind: "epub_text" as const, sectionIndex: 2, start: 10, end: 20 },
    };

    expect(() => parseToolArguments("book_read", {
      locator,
      endLocator: locator,
      direction: "around",
    })).toThrow(/around reads cannot include endLocator/u);
  });

  it("registers delegation only for nodes below the maximum depth", () => {
    const rootNames = rootAgentTools.map((tool) => tool.function.name);
    const childNames = childAgentTools.map((tool) => tool.function.name);
    const recursiveNames = recursiveChildAgentTools.map((tool) => tool.function.name);

    expect(rootNames).toEqual(expect.arrayContaining([
      "book_toc",
      "book_toc_tree",
      "book_read_from_toc",
      "book_read",
      "book_search_text",
      "book_list_annotations",
      "update_plan",
      "update_reading_state",
      "delegate_reading",
      "complete_task",
    ]));
    expect(rootNames).not.toContain("book_toc_navigation");
    expect(rootNames).not.toContain("book_semantic_search");
    expect(childNames).toContain("complete_subtask");
    expect(childNames).toContain("update_plan");
    expect(childNames).toContain("update_reading_state");
    expect(childNames).not.toContain("delegate_reading");
    expect(childNames).not.toContain("complete_task");
    expect(recursiveNames).toContain("delegate_reading");
    expect(recursiveNames).toContain("complete_subtask");
  });

  it("describes complete TOC-node reading and its structured oversize recovery", () => {
    const readFromToc = rootAgentTools.find(
      (tool) => tool.function.name === "book_read_from_toc",
    )!;

    expect(readFromToc.function.description).toMatch(/Large parents split recursively.*complete subtrees and own text/is);
    expect(readFromToc.function.description).toMatch(/50,000.*without truncation/is);
    expect(readFromToc.function.description).toMatch(/continuation\.next.*book_read_from_toc.*unavailable.*TOC_NODE_TOO_LARGE/is);
  });

  it("describes the model-visible section and book boundaries before book_read", () => {
    const read = rootAgentTools.find(
      (tool) => tool.function.name === "book_read",
    )!;

    expect(read.function.description).toMatch(/cross EPUB sections.*maxChars.*endLocator.*book boundary/is);
    expect(read.function.description).toMatch(/segments.*continuation.*boundary/is);
  });

  it("declares selection boundaries and model-visible return fields for all reading tools", () => {
    const descriptions = new Map(rootAgentTools.map((tool) => [
      tool.function.name,
      tool.function.description,
    ]));

    expect(descriptions.get("book_toc")).toMatch(
      /flat.*paginated.*entries\[nodeId,parentNodeId,label,level,chars,hasChildren\].*nextCursor.*hasMore.*not.*locator/is,
    );
    expect(descriptions.get("book_toc_tree")).toMatch(
      /complete.*nested.*200.*entries\[nodeId,label,chars,children\].*not.*paginated.*not.*locator/is,
    );
    expect(descriptions.get("book_read_from_toc")).toMatch(
      /nodeIds.*complete subtrees.*50,000.*without truncation.*text.*units.*unavailable.*coverage/is,
    );
    expect(descriptions.get("book_read")).toMatch(
      /continuation\.previous\/next.*Forward and backward.*cross EPUB sections.*4,000.*50,000.*text.*segments.*continuation.*boundary.*evidence/is,
    );
    expect(descriptions.get("book_search_text")).toMatch(
      /literal.*not.*semantic.*hits\[resultIndex,matchedText,snippet,chapterPath,citation\].*locator.*nextCursor.*hasMore.*30/is,
    );
    expect(descriptions.get("book_list_annotations")).toMatch(
      /read-only.*items\[annotationId,type,selectedText,note,chapterLabel,createdAt,updatedAt,location,citation\].*location\.quality.*locator.*nextCursor.*hasMore.*50/is,
    );
  });

  it("describes control-tool success results or terminal effects without invented fields", () => {
    const tools = [
      ...rootAgentTools,
      ...childAgentTools,
      ...conversationAgentTools({ root: true, canDelegate: true, canImportEvidence: true }),
    ];
    const descriptions = new Map(tools.map((tool) => [tool.function.name, tool.function.description]));

    expect(descriptions.get("update_plan")).toMatch(/returns.*accepted=true.*continues/is);
    expect(descriptions.get("update_reading_state")).toMatch(/returns.*accepted=true.*continues/is);
    expect(descriptions.get("delegate_reading")).toMatch(
      /pauses.*ChildRunResult\[agentRunId,status,findings,evidenceIds,openQuestions,usage,errorCode\]/is,
    );
    expect(descriptions.get("conversation_import_evidence")).toMatch(
      /imported\[evidenceId,sourceEvidenceId,chapterPath\]/is,
    );
    expect(descriptions.get("complete_subtask")).toMatch(/terminal child.*no further model turn/is);
    expect(descriptions.get("complete_task")).toMatch(/terminal root-task.*no further model turn/is);
    expect(descriptions.get("complete_turn")).toMatch(/terminal.*no further model turn/is);
    expect(descriptions.get("request_clarification")).toMatch(/needs_input.*no further model turn/is);
  });

  it("exports actionable field descriptions for plan and bounded reading state", () => {
    const plan = rootAgentTools.find((tool) => tool.function.name === "update_plan")!;
    const readingState = rootAgentTools.find((tool) => tool.function.name === "update_reading_state")!;
    const serializedPlan = JSON.stringify(plan.function.parameters);
    const serializedReadingState = JSON.stringify(readingState.function.parameters);

    expect(serializedPlan).toMatch(/title.*exact field name/is);
    expect(serializedPlan).toMatch(/replacementReason.*JSON null.*never.*string/is);
    expect(serializedReadingState).toMatch(/evidenceIds.*at most 4/is);
    expect(serializedReadingState).toMatch(/findings.*sectionDigests.*openQuestions/is);
  });

  it("keeps every distinct V2 tool definition below the 10K estimated-token budget", () => {
    const tools = [
      ...rootAgentTools,
      ...recursiveChildAgentTools,
      ...conversationAgentTools({ root: true, canDelegate: true, canImportEvidence: true }),
    ];
    const unique = [...new Map(tools.map((tool) => [tool.function.name, tool])).values()];
    expect(estimateTokens(JSON.stringify(unique))).toBeLessThan(10_000);
  });

  it("rejects unknown arguments at runtime", () => {
    expect(() => parseToolArguments("book_toc", { cursor: null, view: "tree" })).toThrow();
    expect(() => parseToolArguments("book_search_text", { query: "cotton", bookId: 9 })).toThrow();
    expect(() => parseToolArguments("delegate_reading", {
      subtasks: [{ id: "s1", goal: "analyze this chapter in detail", deliverable: "return chapter findings" }],
      recursive: true,
    })).toThrow();
  });

  it("normalizes nullable strict-schema fields before runtime validation", () => {
    expect(parseToolArguments("book_toc", { cursor: null, limit: null })).toEqual({});
    expect(parseToolArguments("book_toc", { cursor: "null", limit: 30 })).toEqual({ limit: 30 });
    expect(parseToolArguments("book_search_text", {
      query: "cotton",
      cursor: "  ",
      limit: 10,
    })).toEqual({ query: "cotton", limit: 10 });
    expect(parseToolArguments("book_read", {
      locator: {
        version: 1,
        position: { kind: "epub_text", sectionIndex: 2, start: 10, end: 20 },
        textQuote: null,
        structure: null,
        readerAnchor: null,
      },
      direction: null,
      maxChars: null,
    })).toEqual({
      locator: {
        version: 1,
        position: { kind: "epub_text", sectionIndex: 2, start: 10, end: 20 },
      },
    });
    expect(() => parseToolArguments("book_search_text", {
      query: null,
      cursor: null,
      limit: null,
    })).toThrow();
  });

  it("normalizes only unambiguous legacy update_plan shapes", () => {
    const steps = [{ id: "structure", title: "确认全书结构", status: "in_progress" }];
    expect(parseToolArguments("update_plan", {
      arguments: JSON.stringify({ steps, replacementReason: null }),
    })).toEqual({ steps });
    expect(parseToolArguments("update_plan", {
      steps: [{ id: "structure", description: "确认全书结构", status: "in_progress" }],
    })).toEqual({ steps });
    expect(() => parseToolArguments("update_plan", {
      steps,
      replacementReason: "null",
    })).toThrow();
    expect(parseToolArguments("update_plan", {
      steps: [{
        id: "structure",
        title: "确认全书结构",
        description: "确认全书结构",
        status: "in_progress",
      }],
    })).toEqual({ steps });
    expect(() => parseToolArguments("update_plan", {
      steps: [{
        id: "structure",
        title: "确认全书结构",
        description: "冲突标题",
        status: "in_progress",
      }],
    })).toThrow();
    expect(() => parseToolArguments("update_plan", { arguments: '{"steps":' })).toThrow();
  });

  it("matches the Reader DTO collection and pagination limits", () => {
    expect(() => parseToolArguments("book_toc_navigation", {
      nodeIds: Array.from({ length: 20 }, (_, index) => `node-${index}`),
    })).not.toThrow();
    expect(() => parseToolArguments("book_toc_navigation", {
      nodeIds: Array.from({ length: 21 }, (_, index) => `node-${index}`),
    })).toThrow();
    expect(() => parseToolArguments("book_toc_navigation", {
      nodeIds: ["duplicate", "duplicate"],
    })).toThrow();
    expect(() => parseToolArguments("book_toc_navigation", {
      nodeIds: ["x".repeat(257)],
    })).toThrow();

    expect(() => parseToolArguments("book_search_text", {
      query: "q".repeat(500), cursor: "c".repeat(2_048), limit: 30,
    })).not.toThrow();
    expect(() => parseToolArguments("book_search_text", { query: "q", limit: 31 })).toThrow();
    expect(() => parseToolArguments("book_search_text", {
      query: "q", cursor: "c".repeat(2_049),
    })).toThrow();

    expect(() => parseToolArguments("book_list_annotations", {
      cursor: "c".repeat(2_048), limit: 50, types: ["highlight", "underline", "squiggly"],
    })).not.toThrow();
    expect(() => parseToolArguments("book_list_annotations", { limit: 51 })).toThrow();
    expect(() => parseToolArguments("book_list_annotations", {
      types: ["highlight", "highlight"],
    })).toThrow();
  });

  it("matches the Reader DTO locator string and read-window limits", () => {
    const locator = {
      version: 1,
      position: { kind: "epub_text", sectionIndex: 2, start: 10, end: 20 },
      textQuote: {
        exact: "e".repeat(256),
        prefix: "p".repeat(128),
        suffix: "s".repeat(128),
      },
      structure: {
        tocNodeId: "n".repeat(128),
        href: "h".repeat(1_024),
        fragment: "f".repeat(512),
        label: "l".repeat(500),
        path: "p".repeat(2_000),
      },
      readerAnchor: { epubcfi: "c".repeat(10_000) },
    };

    expect(() => parseToolArguments("book_read", { locator, maxChars: 200 })).not.toThrow();
    expect(() => parseToolArguments("book_read", { locator, maxChars: 50_000 })).not.toThrow();
    expect(() => parseToolArguments("book_read", { locator, maxChars: 199 })).toThrow();
    expect(() => parseToolArguments("book_read", { locator, maxChars: 50_001 })).toThrow();
    expect(parseToolArguments("book_read", {
      locator,
      endLocator: {
        version: 1,
        position: { kind: "epub_text", sectionIndex: 2, start: 20_000, end: 20_000 },
      },
    })).toMatchObject({ endLocator: expect.any(Object) });
    expect(() => parseToolArguments("book_read", { locator, maxBatchChars: 16_000 })).toThrow();

    const oversizedFields: Array<(value: any) => void> = [
      (value) => { value.textQuote.exact += "x"; },
      (value) => { value.textQuote.prefix += "x"; },
      (value) => { value.textQuote.suffix += "x"; },
      (value) => { value.structure.tocNodeId += "x"; },
      (value) => { value.structure.href += "x"; },
      (value) => { value.structure.fragment += "x"; },
      (value) => { value.structure.label += "x"; },
      (value) => { value.structure.path += "x"; },
      (value) => { value.readerAnchor.epubcfi += "x"; },
    ];
    for (const mutate of oversizedFields) {
      const oversized = JSON.parse(JSON.stringify(locator));
      mutate(oversized);
      expect(() => parseToolArguments("book_read", { locator: oversized })).toThrow();
    }
  });

  it("hard-bounds reading-state findings, section digests, questions, and evidence IDs", () => {
    const evidenceIds = ["e1", "e2", "e3", "e4"];
    expect(() => parseToolArguments("update_reading_state", {
      findings: Array.from({ length: 10 }, (_, index) => ({
        statement: `finding-${index}`,
        evidenceIds,
      })),
      sectionDigests: Array.from({ length: 6 }, (_, index) => ({
        sectionIndex: index,
        start: 0,
        end: 1_000,
        digest: `digest-${index}`,
        evidenceIds,
      })),
      openQuestions: Array.from({ length: 6 }, (_, index) => `question-${index}`),
    })).not.toThrow();
    expect(() => parseToolArguments("update_reading_state", {
      findings: Array.from({ length: 11 }, (_, index) => ({
        statement: `finding-${index}`,
        evidenceIds: ["e1"],
      })),
      sectionDigests: [],
      openQuestions: [],
    })).toThrow();
    expect(parseToolArguments("update_reading_state", {
      findings: [{ statement: "bounded ids", evidenceIds: ["e1", "e2", "e2", "e3", "e4", "e5"] }],
      sectionDigests: [],
      openQuestions: [],
    })).toEqual({
      findings: [{ statement: "bounded ids", evidenceIds: ["e1", "e2", "e3", "e4"] }],
      sectionDigests: [],
      openQuestions: [],
    });
    expect(() => parseToolArguments("update_reading_state", {
      findings: [{ statement: "invalid id", evidenceIds: ["e1", 2] }],
      sectionDigests: [],
      openQuestions: [],
    })).toThrow();
  });

  it("projects actionable schema constraints without argument values or validator messages", () => {
    let error: unknown;
    try {
      parseToolArguments("update_reading_state", {
        findings: Array.from({ length: 11 }, (_, index) => ({
          statement: `bounded finding ${index}`,
          evidenceIds: [`private-${index}`],
        })),
        sectionDigests: [],
        openQuestions: [],
      });
    } catch (caught) {
      error = caught;
    }

    const issues = toolArgumentIssues(error);
    expect(issues).toEqual([{
      path: "$.findings",
      code: "too_big",
      origin: "array",
      maximum: 10,
      inclusive: true,
    }]);
    expect(JSON.stringify(issues)).not.toMatch(/private-|message|received/i);
  });

  it("reports deterministic reading-state evidence truncation diagnostics", () => {
    const parsed = parseToolArgumentsWithDiagnostics("update_reading_state", {
      findings: [{ statement: "bounded", evidenceIds: ["e1", "e2", "e2", "e3", "e4", "e5"] }],
      sectionDigests: [],
      openQuestions: [],
    });

    expect(parsed).toMatchObject({
      value: { findings: [{ evidenceIds: ["e1", "e2", "e3", "e4"] }] },
      normalization: { truncatedEvidenceIds: 1 },
    });
  });
});

function expectEveryObjectPropertyRequired(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) expectEveryObjectPropertyRequired(item);
    return;
  }
  if (!value || typeof value !== "object") return;

  const schema = value as Record<string, unknown>;
  const type = schema.type;
  const isObject = type === "object" || (Array.isArray(type) && type.includes("object"));
  if (isObject) {
    const properties = (schema.properties ?? {}) as Record<string, unknown>;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required ?? []).toEqual(Object.keys(properties));
  }
  for (const item of Object.values(schema)) expectEveryObjectPropertyRequired(item);
}
