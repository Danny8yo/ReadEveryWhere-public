import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { z } from "zod";
import { createReaderToolsApiClient } from "./api-client.mjs";

const contentRevisionSchema = z.object({
  fileChecksum: z.string().min(1).max(128),
  extractorVersion: z.string().min(1).max(64),
  normalizationVersion: z.string().min(1).max(64)
}).strict();

const locatorSchema = z.object({
  version: z.literal(1),
  bookId: z.number().int().positive(),
  contentRevision: contentRevisionSchema,
  position: z.object({
    kind: z.literal("epub_text"),
    sectionIndex: z.number().int().nonnegative(),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative()
  }).strict(),
  textQuote: z.object({
    exact: z.string().max(256),
    prefix: z.string().max(128).optional(),
    suffix: z.string().max(128).optional()
  }).strict().optional(),
  structure: z.object({
    tocNodeId: z.string().max(128).optional(),
    href: z.string().max(1024).optional(),
    fragment: z.string().max(512).optional(),
    label: z.string().max(500).optional(),
    path: z.string().max(2000).optional()
  }).strict().optional(),
  readerAnchor: z.object({ epubcfi: z.string().max(10_000).optional() }).strict().optional()
}).strict().superRefine((locator, context) => {
  if (locator.position.end < locator.position.start) {
    context.addIssue({ code: "custom", path: ["position", "end"], message: "end must be >= start" });
  }
});

const bookReadInputSchema = z.object({
  locator: locatorSchema.describe("An unmodified locator returned by a ReadEveryWhere reader tool."),
  endLocator: locatorSchema.optional().describe("Optional reading-intent target boundary copied unchanged from a continuation object."),
  direction: z.enum(["forward", "backward", "around"]).default("forward"),
  maxChars: z.number().int().min(200).max(50000).default(4000)
}).strict().superRefine((input, context) => {
  if (input.direction === "around" && input.endLocator) {
    context.addIssue({
      code: "custom",
      path: ["endLocator"],
      message: "around reads cannot include endLocator"
    });
  }
});

const bookIdSchema = z.number().int().positive().describe("A bookId returned by library_search.");
function readOnlyTool(title) {
  return {
    title,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true
    }
  };
}

function toolResult(result, summary, project = (data) => data) {
  if (result.ok) {
    const data = project(result.data);
    return {
      structuredContent: data,
      content: [{ type: "text", text: summary(data) }]
    };
  }

  return {
    structuredContent: result.error,
    content: [{ type: "text", text: `${result.error.code}: ${result.error.message} Next: ${result.error.suggestedAction}` }],
    isError: true
  };
}

function readResult(data) {
  if (Array.isArray(data.units)) {
    return { text: data.text, segments: data.segments, units: data.units,
      unavailable: data.unavailable, coverage: data.coverage, continuation: data.continuation };
  }
  const continuation = data?.continuation ?? {
    previous: data?.previousLocator ? { locator: data.previousLocator, direction: "backward" } : null,
    next: data?.nextLocator ? { locator: data.nextLocator, direction: "forward" } : null
  };
  const boundary = data?.boundary ?? {
    sectionStart: data?.reachedSectionStart === true,
    sectionEnd: data?.reachedSectionEnd === true,
    bookStart: data?.reachedBookStart === true,
    bookEnd: data?.reachedBookEnd === true
  };
  return {
    text: typeof data?.text === "string" ? data.text : "",
    ...(data?.node ? { node: data.node } : {}),
    segments: Array.isArray(data?.segments) ? data.segments : [],
    continuation,
    boundary
  };
}

function treeToolResult(result) {
  if (!result.ok && result.error.code === "TOC_TREE_TOO_LARGE") {
    return {
      ...result,
      error: {
        ...result.error,
        suggestedAction: "Use book_toc with its cursor; book_toc_tree is limited to 200 TOC nodes."
      }
    };
  }
  return result;
}

export function createServer(options = {}) {
  const client = options.client ?? createReaderToolsApiClient();
  const server = new McpServer(
    { name: "readeverywhere-reader-tools", version: "0.6.0" },
    {
      instructions: [
        "Read-only access to the authenticated user's private ReadEveryWhere library.",
        "Start with library_search when bookId is unknown. Never invent or modify bookId, ContentRevision, or locator offsets.",
        "Use book_toc for paginated structure, book_toc_tree for a small complete hierarchy, book_read_from_toc to read a selected node directly, book_search_text for literal occurrences, and book_read to continue or inspect a known locator.",
        "book_semantic_search currently reports INDEX_NOT_CONFIGURED; recover with book_toc or book_search_text.",
        "Only book_read or book_read_from_toc read_context citations and exact user annotations are final evidence for explanatory claims."
      ].join(" ")
    }
  );

  server.registerTool(
    "library_search",
    {
      ...readOnlyTool("Search private library"),
      description: [
        "Search or list books in the authenticated user's private library and return bookId values.",
        "Use when the user names a book but no bookId is known, or asks what books are available.",
        "Do not use it to search inside book text. Only items with readable=true can currently be opened by EPUB reader tools."
      ].join(" "),
      inputSchema: {
        query: z.string().max(200).optional().describe("Optional title or author substring. Omit to list recent books."),
        cursor: z.string().min(1).max(2048).optional().describe("Opaque cursor from the same query and limit."),
        limit: z.number().int().min(1).max(50).default(20)
      }
    },
    async (input) => toolResult(
      await client.call("library_search", input),
      (data) => `Returned ${data.items.length} private-library books. hasMore=${data.hasMore}.`
    )
  );

  server.registerTool(
    "book_get_metadata",
    {
      ...readOnlyTool("Get book metadata"),
      description: [
        "Get identity, ContentRevision, content size, annotation counts, and capability readiness for one authorized book.",
        "The response's contentStats.tocQuality is declared when the original TOC mapping is usable, declared_repaired when it was reliably re-anchored to book text, or spine_fallback when an unsafe declared TOC was replaced by EPUB spine order.",
        "Use after library_search and before a substantial reading task or when capability status matters.",
        "Do not use it to read text, inspect the TOC, or search content."
      ].join(" "),
      inputSchema: { bookId: z.number().int().positive().describe("A bookId returned by library_search.") }
    },
    async (input) => toolResult(
      await client.call("book_get_metadata", input),
      (data) => `Loaded metadata for ${data.book.title}; semanticSearch=${data.capabilities.semanticSearch}.`
    )
  );

  server.registerTool(
    "book_toc",
    {
      ...readOnlyTool("List book table of contents"),
      description: [
        "Return a paginated, flat TOC in stable DFS reading order for an authorized EPUB book.",
        "Use it first to understand a large book, select nodeId values, or continue with nextCursor.",
        "Use book_toc_tree instead only when a complete nested hierarchy is needed. After selecting a nodeId, use book_read_from_toc to retrieve its bounded text directly.",
        "It does not return chapter text."
      ].join(" "),
      inputSchema: z.object({
        bookId: bookIdSchema,
        cursor: z.string().min(1).max(2048).optional().describe("Opaque cursor from an earlier book_toc response."),
        limit: z.number().int().min(1).max(200).optional().describe("Maximum entries; default 100.")
      }).strict()
    },
    async (input) => toolResult(
      await client.call("book_toc", { ...input, mode: "outline" }),
      (data) => `Returned ${data.entries.length} TOC entries. hasMore=${data.hasMore}.`
    )
  );

  server.registerTool(
    "book_toc_tree",
    {
      ...readOnlyTool("Get complete book table-of-contents tree"),
      description: [
        "Return an authorized EPUB book's complete nested TOC tree with chapter character budgets.",
        "Use only when the complete hierarchy is needed for a reading plan. It is limited to books with at most 200 TOC nodes and cannot be paginated.",
        "For large TOCs, recover with book_toc. It does not return chapter text or locators; use book_read_from_toc after selecting a nodeId."
      ].join(" "),
      inputSchema: z.object({ bookId: bookIdSchema }).strict()
    },
    async (input) => toolResult(
      treeToolResult(await client.call("book_toc", { ...input, mode: "tree" })),
      (data) => `Returned a complete TOC tree with ${data.entries.length} root entries.`
    )
  );

  server.registerTool(
    "book_read_from_toc",
    {
      ...readOnlyTool("Read complete TOC units"),
      description: [
        "Read nodeIds from book_toc or book_toc_tree in book order. Large parents split recursively into complete subtrees and own text; batches contain at most 50,000 normalized UTF-16 characters without truncation.",
        "Pass continuation.next unchanged to book_read_from_toc with the same bookId. Use nodeIds OR cursor. Never continue TOC reading with book_read.",
        "The result contains text, segments, units with text offsets and boundaries, unavailable units, coverage and continuation. Text across units may be discontinuous. TOC_NODE_TOO_LARGE and TOC_NODE_NOT_READABLE identify unread gaps; report them without character-read recovery or summary delegation. A null continuation does not imply full coverage."
      ].join(" "),
      inputSchema: z.object({
        bookId: bookIdSchema,
        nodeIds: z.array(z.string().min(1).max(256)).min(1).max(200).optional(),
        cursor: z.string().min(1).max(300_000).optional()
      }).strict().refine((input) => (input.nodeIds !== undefined) !== (input.cursor !== undefined),
        "Exactly one of nodeIds and cursor is required")
    },
    async (input) => toolResult(
      await client.call("book_read_from_toc", input),
      (data) => `Read ${data.units.length} complete unit(s), ${data.text.length} UTF-16 code units; ${data.coverage.unavailableUnits} unavailable unit(s). Coverage complete: ${data.coverage.complete}.`,
      readResult
    )
  );

  server.registerTool(
    "book_read",
    {
      ...readOnlyTool("Read bounded book text"),
      description: [
        "Read a bounded continuous range of normalized EPUB text from an unmodified locator returned by another tool, or continue by passing continuation.previous/next unchanged as this tool's arguments.",
        "Forward and backward may cross EPUB sections and stop at maxChars, endLocator, or a book boundary. maxChars defaults to 4,000 and is at most 50,000; around expands one local search hit and cannot include endLocator.",
        "The response returns per-section read_context citation segments, directly reusable continuation, and section/book boundary flags.",
        "Do not use it to search unknown locations or request a whole book. The read_context citation is final book evidence."
      ].join(" "),
      inputSchema: bookReadInputSchema
    },
    async (input) => toolResult(
      await client.call("book_read", input),
      (data) => `Read ${data.text.length} UTF-16 code units across ${data.segments.length} cited segment(s).`,
      readResult
    )
  );

  server.registerTool(
    "book_search_text",
    {
      ...readOnlyTool("Search exact book text"),
      description: [
        "Find literal contiguous text in one authorized book's normalized EPUB text.",
        "Use for exact terms, quotations, names, API identifiers, and code symbols.",
        "It does not parse AND/OR, perform semantic expansion, or rank by BM25. Read citation.locator around the hit for explanatory context."
      ].join(" "),
      inputSchema: {
        bookId: bookIdSchema,
        query: z.string().min(1).max(500),
        cursor: z.string().min(1).max(2048).optional(),
        limit: z.number().int().min(1).max(30).default(10)
      }
    },
    async (input) => toolResult(
      await client.call("book_search_text", input),
      (data) => `Found ${data.hits.length} literal matches. hasMore=${data.hasMore}.`
    )
  );

  server.registerTool(
    "book_semantic_search",
    {
      ...readOnlyTool("Search book semantically"),
      description: [
        "Reserved provider-neutral semantic search for one authorized book.",
        "The real embedding index is not configured in stage 0A, so this currently returns INDEX_NOT_CONFIGURED.",
        "Recover by using book_toc or book_search_text; never treat an error as empty evidence."
      ].join(" "),
      inputSchema: {
        bookId: z.number().int().positive().describe("A bookId returned by library_search."),
        query: z.string().min(1).max(1000),
        topK: z.number().int().min(1).max(20).default(8)
      }
    },
    async (input) => toolResult(
      await client.call("book_semantic_search", input),
      (data) => `Returned ${data.hits.length} semantic candidates.`
    )
  );

  server.registerTool(
    "book_list_annotations",
    {
      ...readOnlyTool("List book annotations"),
      description: [
        "List the authenticated user's existing annotations for one authorized book in reading order.",
        "Use to understand reader interests. This tool cannot create, update, or delete annotations.",
        "Only location.quality=exact has a citation and a locator safe to pass directly to book_read."
      ].join(" "),
      inputSchema: {
        bookId: z.number().int().positive().describe("A bookId returned by library_search."),
        cursor: z.string().min(1).max(2048).optional(),
        limit: z.number().int().min(1).max(50).default(20),
        hasNote: z.boolean().optional(),
        types: z.array(z.enum(["highlight", "underline", "squiggly"])).min(1).max(3).optional()
      }
    },
    async (input) => toolResult(
      await client.call("book_list_annotations", input),
      (data) => `Returned ${data.items.length} annotations. hasMore=${data.hasMore}.`
    )
  );

  return server;
}

async function main() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
