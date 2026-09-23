import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createReaderToolsApiClient } from "../src/api-client.mjs";
import { createServer } from "../src/server.mjs";

const locator = {
  version: 1,
  bookId: 42,
  contentRevision: {
    fileChecksum: "sha256:test",
    extractorVersion: "epub-extractor-v2",
    normalizationVersion: "epub-text-v1"
  },
  position: { kind: "epub_text", sectionIndex: 2, start: 10, end: 14 },
  textQuote: { exact: "拥塞控制" }
};
const endLocator = {
  ...locator,
  position: { kind: "epub_text", sectionIndex: 2, start: 120, end: 120 },
  textQuote: { exact: "" }
};
const forwardContinuation = { locator, endLocator, direction: "forward" };

function success(toolName, data) {
  return {
    ok: true,
    data
  };
}

function semanticUnavailable() {
  return {
    ok: false,
    error: {
      code: "INDEX_NOT_CONFIGURED",
      message: "Semantic index is not configured",
      recoverable: false,
      suggestedAction: "Use book_toc or book_search_text; semantic retrieval is not available yet."
    }
  };
}

function dataFor(toolName) {
  switch (toolName) {
    case "library_search":
      return { items: [{ bookId: 42, title: "计算机网络", authors: ["作者"], readable: true }], hasMore: false, nextCursor: null };
    case "book_get_metadata":
      return {
        book: { bookId: 42, title: "计算机网络" },
        contentStats: { tocQuality: "declared_repaired" },
        capabilities: { semanticSearch: "not_configured" }
      };
    case "book_toc":
      return {
        tocQuality: "declared_repaired",
        entries: [{ nodeId: "toc-1", label: "拥塞控制", startLocator: locator, endLocator }],
        hasMore: false,
        nextCursor: null
      };
    case "book_read_from_toc":
    case "book_read":
      return {
        text: "这里讨论拥塞控制。",
        ...(toolName === "book_read_from_toc"
          ? { units: [{ nodeId: "toc-1", label: "拥塞控制", kind: "subtree", normalizedCharCount: 9,
              textStart: 0, textEnd: 9, startLocator: locator, endLocator, complete: true }],
              unavailable: [], coverage: { complete: true, unavailableUnits: 0 } }
          : {}),
        continuation: { previous: null, next: toolName === "book_read_from_toc" ? null : forwardContinuation },
        reachedSectionStart: true,
        reachedSectionEnd: false,
        reachedBookStart: false,
        reachedBookEnd: false,
        previousLocator: null,
        nextLocator: locator,
        segments: [{
          textStart: 0,
          textEnd: 9,
          citation: { evidenceType: "read_context", chapterPath: "传输层 / 拥塞控制", locator }
        }],
        requestId: "must-not-reach-model",
        contentRevision: locator.contentRevision
      };
    case "book_search_text":
      return { hits: [{ citation: { locator } }], hasMore: false, nextCursor: null };
    case "book_list_annotations":
      return { items: [{ id: "annotation-1", location: { quality: "exact", locator } }], hasMore: false, nextCursor: null };
    default:
      throw new Error(`No fake response for ${toolName}`);
  }
}

async function withClient(fakeClient, run) {
  const server = createServer({ client: fakeClient });
  const client = new Client({ name: "reader-tools-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    await run(client);
  } finally {
    await client.close();
  }
}

function structured(result) {
  assert.ok(result.structuredContent, "tool result should include structuredContent");
  return result.structuredContent;
}

test("advertises nine private-library read-only tools with explicit book scope", async () => {
  const fakeClient = { call: async (toolName) => success(toolName, dataFor(toolName)) };
  await withClient(fakeClient, async (client) => {
    const response = await client.listTools();
    const names = response.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [
      "book_get_metadata",
      "book_list_annotations",
      "book_read",
      "book_read_from_toc",
      "book_search_text",
      "book_semantic_search",
      "book_toc",
      "book_toc_tree",
      "library_search"
    ]);

    for (const tool of response.tools) {
      assert.equal(tool.annotations?.readOnlyHint, true);
      assert.equal(tool.annotations?.destructiveHint, false);
      assert.equal(tool.annotations?.openWorldHint, false);
      assert.equal(tool.annotations?.idempotentHint, true);
    }

    const libraryTool = response.tools.find((tool) => tool.name === "library_search");
    assert.ok(libraryTool.inputSchema.properties.query);
    for (const name of ["book_get_metadata", "book_toc", "book_toc_tree", "book_read_from_toc", "book_search_text", "book_semantic_search", "book_list_annotations"]) {
      const tool = response.tools.find((candidate) => candidate.name === name);
      assert.ok(tool.inputSchema.properties.bookId, `${name} should require an explicit bookId`);
      assert.ok(tool.inputSchema.required.includes("bookId"));
    }

    const tocTool = response.tools.find((tool) => tool.name === "book_toc");
    assert.deepEqual(Object.keys(tocTool.inputSchema.properties).sort(), ["bookId", "cursor", "limit"]);
    assert.deepEqual(tocTool.inputSchema.required, ["bookId"]);
    assert.equal(tocTool.inputSchema.additionalProperties, false);
    const treeTool = response.tools.find((tool) => tool.name === "book_toc_tree");
    assert.deepEqual(Object.keys(treeTool.inputSchema.properties), ["bookId"]);
    assert.deepEqual(treeTool.inputSchema.required, ["bookId"]);
    assert.equal(treeTool.inputSchema.additionalProperties, false);
    const readFromTocTool = response.tools.find((tool) => tool.name === "book_read_from_toc");
    assert.deepEqual(Object.keys(readFromTocTool.inputSchema.properties).sort(), ["bookId", "cursor", "nodeIds"]);
    assert.deepEqual(readFromTocTool.inputSchema.required.sort(), ["bookId"]);
    assert.equal(readFromTocTool.inputSchema.additionalProperties, false);
    assert.match(readFromTocTool.description, /complete subtrees and own text/is);
    assert.match(readFromTocTool.description, /TOC_NODE_TOO_LARGE.*unread gaps/is);
    const metadataTool = response.tools.find((tool) => tool.name === "book_get_metadata");
    assert.match(metadataTool.description, /tocQuality.*declared.*declared_repaired.*spine_fallback/is);
    const readTool = response.tools.find((tool) => tool.name === "book_read");
    assert.deepEqual(Object.keys(readTool.inputSchema.properties).sort(), [
      "direction",
      "endLocator",
      "locator",
      "maxChars"
    ]);
    assert.deepEqual(readTool.inputSchema.required, ["locator"]);
    for (const internalField of ["maxBatchChars", "segments", "batch"]) {
      assert.equal(readTool.inputSchema.properties[internalField], undefined);
    }
    assert.equal(readTool.inputSchema.additionalProperties, false);
    assert.equal(readTool.inputSchema.properties.maxChars.maximum, 50000);
    assert.match(readTool.description, /continuation\.previous\/next.*unchanged/is);
    assert.match(readTool.description, /around.*cannot.*endLocator/is);
    assert.match(tocTool.description, /book_read_from_toc/is);
    assert.equal(response.tools.some((tool) => tool.name === "book_toc_navigation"), false);
  });
});

test("rejects unknown arguments for structure and TOC-node reading tools before calling the backend", async () => {
  const calls = [];
  const fakeClient = {
    async call(toolName, args) {
      calls.push({ toolName, args });
      return success(toolName, dataFor(toolName));
    }
  };

  await withClient(fakeClient, async (client) => {
    for (const [name, args] of [
      ["book_toc", { bookId: 42, mode: "outline" }],
      ["book_toc_tree", { bookId: 42, cursor: "unexpected" }],
      ["book_read_from_toc", { bookId: 42, nodeId: "toc-1", limit: 1 }],
      ["book_read_from_toc", { bookId: 42 }],
      ["book_read_from_toc", { bookId: 42, nodeIds: [] }],
      ["book_read_from_toc", { bookId: 42, nodeIds: ["toc-1"], cursor: "cursor" }],
      ["book_read_from_toc", { bookId: 42, nodeIds: ["toc-1"], maxChars: 500 }]
    ]) {
      const result = await client.callTool({ name, arguments: args });
      assert.equal(result.isError, true, `${name} should reject unknown arguments`);
      assert.match(result.content[0].text, /invalid|unrecognized|argument/i);
    }
  });

  assert.deepEqual(calls, []);
});

test("rejects incompatible or extra book_read arguments before calling the backend", async () => {
  const calls = [];
  const fakeClient = {
    async call(toolName, args) {
      calls.push({ toolName, args });
      return success(toolName, dataFor(toolName));
    }
  };

  await withClient(fakeClient, async (client) => {
    const aroundWithBoundary = await client.callTool({
      name: "book_read",
      arguments: { locator, endLocator, direction: "around", maxChars: 800 }
    });
    assert.equal(aroundWithBoundary.isError, true);
    assert.match(aroundWithBoundary.content[0].text, /endLocator|around|invalid/i);

    const extra = await client.callTool({
      name: "book_read",
      arguments: { locator, direction: "forward", maxChars: 800, maxBatchChars: 16000 }
    });
    assert.equal(extra.isError, true);
    assert.match(extra.content[0].text, /invalid|unrecognized|argument/i);
  });

  assert.deepEqual(calls, []);
});

test("forwards validated tool arguments and returns direct success data and structured errors", async () => {
  const calls = [];
  const fakeClient = {
    async call(toolName, args) {
      calls.push({ toolName, args });
      if (toolName === "book_semantic_search") return semanticUnavailable();
      return success(toolName, dataFor(toolName));
    }
  };

  await withClient(fakeClient, async (client) => {
    const library = structured(await client.callTool({
      name: "library_search",
      arguments: { query: "计算机", limit: 5 }
    }));
    assert.equal(library.items[0].bookId, 42);

    const metadata = structured(await client.callTool({ name: "book_get_metadata", arguments: { bookId: 42 } }));
    await client.callTool({
      name: "book_toc",
      arguments: { bookId: 42, cursor: "toc-next", limit: 20 }
    });
    await client.callTool({
      name: "book_toc_tree",
      arguments: { bookId: 42 }
    });
    const readFromToc = structured(await client.callTool({
      name: "book_read_from_toc",
      arguments: { bookId: 42, nodeIds: ["toc-1"] }
    }));
    await client.callTool({ name: "book_search_text", arguments: { bookId: 42, query: "拥塞控制", limit: 3 } });
    const read = structured(await client.callTool({
      name: "book_read",
      arguments: { ...forwardContinuation, maxChars: 800 }
    }));
    await client.callTool({ name: "book_list_annotations", arguments: { bookId: 42, hasNote: true, limit: 10 } });

    const semanticResult = await client.callTool({
      name: "book_semantic_search",
      arguments: { bookId: 42, query: "为什么会拥塞", topK: 5 }
    });
    const semantic = structured(semanticResult);
    assert.equal(metadata.contentStats.tocQuality, "declared_repaired");
    assert.equal(readFromToc.continuation.next, null);
    assert.deepEqual(read.continuation.next, forwardContinuation);
    assert.deepEqual(Object.keys(readFromToc).sort(), ["continuation", "coverage", "segments", "text", "unavailable", "units"]);
    assert.deepEqual(Object.keys(read).sort(), ["boundary", "continuation", "segments", "text"]);
    assert.equal(JSON.stringify(read).includes("must-not-reach-model"), false);
    assert.equal(semanticResult.isError, true);
    assert.equal(semantic.code, "INDEX_NOT_CONFIGURED");
    assert.match(semantic.suggestedAction, /book_toc|book_search_text/u);
  });

  assert.deepEqual(calls, [
    { toolName: "library_search", args: { query: "计算机", limit: 5 } },
    { toolName: "book_get_metadata", args: { bookId: 42 } },
    { toolName: "book_toc", args: { bookId: 42, cursor: "toc-next", limit: 20, mode: "outline" } },
    { toolName: "book_toc", args: { bookId: 42, mode: "tree" } },
    { toolName: "book_read_from_toc", args: { bookId: 42, nodeIds: ["toc-1"] } },
    { toolName: "book_search_text", args: { bookId: 42, query: "拥塞控制", limit: 3 } },
    { toolName: "book_read", args: { ...forwardContinuation, maxChars: 800 } },
    { toolName: "book_list_annotations", args: { bookId: 42, limit: 10, hasNote: true } },
    { toolName: "book_semantic_search", args: { bookId: 42, query: "为什么会拥塞", topK: 5 } }
  ]);
});

test("returns AUTH_TOKEN_MISSING before making an HTTP request", async () => {
  let fetched = false;
  const client = createReaderToolsApiClient({
    token: "",
    fetchImpl: async () => {
      fetched = true;
      throw new Error("should not fetch");
    }
  });

  const result = await client.call("library_search", { limit: 20 });
  assert.equal(fetched, false);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "AUTH_TOKEN_MISSING");
  assert.match(result.error.suggestedAction, /READEVERYWHERE_AI_TOKEN/u);
});

test("maps every tool to the real Reader Tools REST endpoint", async () => {
  const requests = [];
  const client = createReaderToolsApiClient({
    baseUrl: "http://127.0.0.1:3456/",
    token: "rew_ai_test",
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return {
        ok: true,
        status: 200,
        headers: { get: () => "http-request-id" },
        json: async () => ({ code: 0, message: "success", data: {}, requestId: "body-request-id" })
      };
    }
  });

  await client.call("library_search", { query: "网络", cursor: "page-2", limit: 5 });
  await client.call("book_get_metadata", { bookId: 42 });
  await client.call("book_toc", { bookId: 42, mode: "outline", cursor: "toc-2", limit: 10 });
  await client.call("book_toc", { bookId: 42, mode: "navigation", nodeIds: ["toc-1"] });
  await client.call("book_read_from_toc", { bookId: 42, nodeIds: ["toc-1"] });
  await client.call("book_read", { ...forwardContinuation, maxChars: 1000 });
  await client.call("book_search_text", { bookId: 42, query: "拥塞", limit: 4 });
  await client.call("book_semantic_search", { bookId: 42, query: "网络拥塞", topK: 6 });
  await client.call("book_list_annotations", { bookId: 42, hasNote: true, types: ["highlight"] });

  const libraryUrl = new URL(requests[0].url);
  assert.equal(libraryUrl.pathname, "/api/v1/reader-tools/library");
  assert.equal(libraryUrl.searchParams.get("query"), "网络");
  assert.equal(libraryUrl.searchParams.get("cursor"), "page-2");
  assert.equal(libraryUrl.searchParams.get("limit"), "5");
  assert.equal(requests[0].init.method, "GET");
  assert.equal(requests[0].init.headers.authorization, "Bearer rew_ai_test");

  assert.equal(requests[1].url, "http://127.0.0.1:3456/api/v1/reader-tools/books/42/metadata");
  assert.equal(requests[2].url, "http://127.0.0.1:3456/api/v1/reader-tools/books/42/toc");
  assert.deepEqual(JSON.parse(requests[2].init.body), { mode: "outline", cursor: "toc-2", limit: 10 });
  assert.equal(requests[3].url, "http://127.0.0.1:3456/api/v1/reader-tools/books/42/toc");
  assert.deepEqual(JSON.parse(requests[3].init.body), { mode: "navigation", nodeIds: ["toc-1"] });
  assert.equal(requests[4].url, "http://127.0.0.1:3456/api/v1/reader-tools/books/42/read-from-toc");
  assert.deepEqual(JSON.parse(requests[4].init.body), { nodeIds: ["toc-1"] });
  assert.equal(requests[5].url, "http://127.0.0.1:3456/api/v1/reader-tools/read");
  assert.deepEqual(JSON.parse(requests[5].init.body), { ...forwardContinuation, maxChars: 1000 });
  assert.equal(requests[6].url, "http://127.0.0.1:3456/api/v1/reader-tools/books/42/search-text");
  assert.deepEqual(JSON.parse(requests[6].init.body), { query: "拥塞", limit: 4 });
  assert.equal(requests[7].url, "http://127.0.0.1:3456/api/v1/reader-tools/books/42/search-semantic");
  assert.deepEqual(JSON.parse(requests[7].init.body), { query: "网络拥塞", topK: 6 });
  assert.equal(requests[8].url, "http://127.0.0.1:3456/api/v1/reader-tools/books/42/annotations");
  assert.deepEqual(JSON.parse(requests[8].init.body), { hasNote: true, types: ["highlight"] });
});

test("maps backend semantic-index errors to actionable MCP errors", async () => {
  const client = createReaderToolsApiClient({
    token: "rew_ai_test",
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      headers: { get: () => "semantic-request-id" },
      json: async () => ({
        code: 50311,
        message: "Semantic search index is not configured",
        details: { reason: "INDEX_NOT_CONFIGURED" },
        requestId: "semantic-request-id"
      })
    })
  });

  const result = await client.call("book_semantic_search", { bookId: 42, query: "拥塞", topK: 8 });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "INDEX_NOT_CONFIGURED");
  assert.equal(result.error.recoverable, false);
  assert.match(result.error.suggestedAction, /book_toc|book_search_text/u);
});

test("maps oversized TOC tree errors to the flat-outline recovery action", async () => {
  const client = createReaderToolsApiClient({
    token: "rew_ai_test",
    fetchImpl: async () => ({
      ok: false,
      status: 409,
      headers: { get: () => "toc-tree-request-id" },
      json: async () => ({
        code: 40914,
        message: "TOC has 201 nodes. Tree representation is limited to 200 nodes.",
        details: { reason: "TOC_TREE_TOO_LARGE", field: "mode" },
        requestId: "toc-tree-request-id"
      })
    })
  });

  const result = await client.call("book_toc", { bookId: 42, mode: "tree" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "TOC_TREE_TOO_LARGE");
  assert.equal(result.error.recoverable, false);
  assert.match(result.error.suggestedAction, /book_toc.+cursor/u);
  assert.doesNotMatch(result.error.suggestedAction, /mode=/u);
});

test("rewrites tree recovery for the MCP book_toc tool names", async () => {
  const fakeClient = {
    async call(toolName) {
      if (toolName === "book_toc") {
        return {
          ok: false,
          error: {
            code: "TOC_TREE_TOO_LARGE",
            message: "TOC has 201 nodes.",
            recoverable: false,
            suggestedAction: "Use mode=outline with cursor pagination."
          }
        };
      }
      return success(toolName, dataFor(toolName));
    }
  };

  await withClient(fakeClient, async (client) => {
    const result = await client.callTool({ name: "book_toc_tree", arguments: { bookId: 42 } });
    const error = structured(result);
    assert.equal(result.isError, true);
    assert.equal(error.code, "TOC_TREE_TOO_LARGE");
    assert.match(error.suggestedAction, /book_toc/u);
    assert.doesNotMatch(error.suggestedAction, /mode=/u);
  });
});

test("preserves unavailable units and TOC continuation without character recovery", async () => {
  const data = { ...dataFor("book_read_from_toc"),
    unavailable: [{ nodeId: "large", kind: "subtree", normalizedCharCount: 68000, reason: "TOC_NODE_TOO_LARGE", startLocator: locator, endLocator }],
    coverage: { complete: false, unavailableUnits: 1 },
    continuation: { next: { cursor: "toc-batch-2" } }
  };
  const calls = [];
  await withClient({ call: async (name, args) => { calls.push(args); return success(name, data); } }, async (client) => {
    const first = structured(await client.callTool({ name: "book_read_from_toc", arguments: { bookId: 42, nodeIds: ["toc-1", "large"] } }));
    assert.deepEqual(first.unavailable, data.unavailable);
    assert.equal(first.coverage.complete, false);
    assert.equal(first.recovery, undefined);
    await client.callTool({ name: "book_read_from_toc", arguments: { bookId: 42, ...first.continuation.next } });
  });
  assert.deepEqual(calls[1], { bookId: 42, cursor: "toc-batch-2" });
});
