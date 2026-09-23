const ERROR_GUIDANCE = {
  AUTH_TOKEN_MISSING: [false, "Set READEVERYWHERE_AI_TOKEN, then restart Claude Code or Codex."],
  UNAUTHORIZED: [false, "Create a new AI access token and restart the MCP client with it."],
  FORBIDDEN: [false, "Use a token with the required read scope; do not retry with another bookId."],
  BOOK_NOT_FOUND: [false, "Call library_search and use a bookId returned for the authenticated user."],
  BOOK_FILE_MISSING: [false, "Download or import the EPUB in ReadEveryWhere before reading it."],
  UNSUPPORTED_FORMAT: [false, "Choose a readable EPUB result from library_search."],
  EXTRACTION_FAILED: [false, "Report that the EPUB could not be extracted; do not invent content."],
  CONTENT_REVISION_MISMATCH: [false, "Discard old locators and restart from book_get_metadata, book_toc, or search."],
  LOCATOR_INVALID: [false, "Use an unmodified locator returned by a reader tool."],
  LOCATOR_OUT_OF_RANGE: [false, "Obtain a fresh locator from book_read_from_toc or search."],
  READING_TARGET_ALREADY_REACHED: [true, "Use the current evidence, follow another continuation, or choose a new target range."],
  TEXT_QUOTE_MISMATCH: [false, "Obtain a fresh locator; do not cite the mismatched location."],
  CURSOR_INVALID: [false, "Restart the same listing or search without a cursor."],
  TOC_REQUEST_INVALID: [false, "Use book_toc with only cursor/limit, book_toc_tree without arguments, or book_read_from_toc with current nodeIds OR cursor."],
  TOC_NODE_NOT_FOUND: [true, "Refresh book_toc or book_toc_tree and copy current nodeIds before reading them."],
  TOC_NODE_NOT_READABLE: [true, "Choose a readable child or adjacent node from the current TOC."],
  TOC_NODE_TOO_LARGE: [false, "Report this unread structural gap. Do not recover through book_read or summary delegation."],
  TOC_TREE_TOO_LARGE: [false, "Use book_toc and continue with its cursor; book_toc_tree is limited to 200 TOC nodes."],
  QUERY_INVALID: [false, "Provide a shorter non-empty query."],
  INDEX_NOT_CONFIGURED: [false, "Use book_toc or book_search_text; semantic retrieval is not available yet."],
  BACKEND_UNAVAILABLE: [true, "Start the ReadEveryWhere backend and retry after checking READEVERYWHERE_BASE_URL."]
};

function failure(code, message, details = {}) {
  const [recoverable, suggestedAction] = ERROR_GUIDANCE[code]
    ?? [false, "Review the error, correct the request, and retry only when safe."];
  return {
    ok: false,
    error: {
      code,
      message,
      recoverable,
      suggestedAction,
    }
  };
}

export function createReaderToolsApiClient(options = {}) {
  const baseUrl = (options.baseUrl ?? process.env.READEVERYWHERE_BASE_URL ?? "http://127.0.0.1:3000")
    .replace(/\/+$/u, "");
  const token = options.token ?? process.env.READEVERYWHERE_AI_TOKEN ?? "";
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  return {
    async call(toolName, args) {
      if (!token) {
        return failure("AUTH_TOKEN_MISSING", "READEVERYWHERE_AI_TOKEN is not set.");
      }

      const request = requestFor(toolName, args, baseUrl);
      try {
        const response = await fetchImpl(request.url, {
          method: request.method,
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/json",
            ...(request.body ? { "content-type": "application/json" } : {})
          },
          ...(request.body ? { body: JSON.stringify(request.body) } : {})
        });
        const payload = await response.json().catch(() => null);
        if (response.ok && payload?.code === 0) {
          return { ok: true, data: payload.data };
        }

        const reason = payload?.details?.reason;
        const code = reason === "UNAUTHORIZED" ? "UNAUTHORIZED"
          : reason === "FORBIDDEN" ? "FORBIDDEN"
            : typeof reason === "string" ? reason : `HTTP_${response.status}`;
        return failure(code, payload?.message ?? `Reader Tools API returned HTTP ${response.status}`, payload?.details);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failure("BACKEND_UNAVAILABLE", `ReadEveryWhere backend is unavailable: ${message}`);
      }
    }
  };
}

function requestFor(toolName, args, baseUrl) {
  switch (toolName) {
    case "library_search": {
      const url = new URL(`${baseUrl}/api/v1/reader-tools/library`);
      if (args.query) url.searchParams.set("query", args.query);
      if (args.cursor) url.searchParams.set("cursor", args.cursor);
      if (args.limit !== undefined) url.searchParams.set("limit", String(args.limit));
      return { method: "GET", url: url.toString() };
    }
    case "book_get_metadata":
      return { method: "GET", url: `${baseUrl}/api/v1/reader-tools/books/${args.bookId}/metadata` };
    case "book_toc":
      return {
        method: "POST",
        url: `${baseUrl}/api/v1/reader-tools/books/${args.bookId}/toc`,
        body: without(args, ["bookId"])
      };
    case "book_read":
      return { method: "POST", url: `${baseUrl}/api/v1/reader-tools/read`, body: args };
    case "book_read_from_toc":
      return {
        method: "POST",
        url: `${baseUrl}/api/v1/reader-tools/books/${args.bookId}/read-from-toc`,
        body: without(args, ["bookId"])
      };
    case "book_search_text":
      return {
        method: "POST",
        url: `${baseUrl}/api/v1/reader-tools/books/${args.bookId}/search-text`,
        body: without(args, ["bookId"])
      };
    case "book_semantic_search":
      return {
        method: "POST",
        url: `${baseUrl}/api/v1/reader-tools/books/${args.bookId}/search-semantic`,
        body: without(args, ["bookId"])
      };
    case "book_list_annotations":
      return {
        method: "POST",
        url: `${baseUrl}/api/v1/reader-tools/books/${args.bookId}/annotations`,
        body: without(args, ["bookId"])
      };
    default:
      throw new Error(`Unknown reader tool: ${toolName}`);
  }
}

function without(value, keys) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}
