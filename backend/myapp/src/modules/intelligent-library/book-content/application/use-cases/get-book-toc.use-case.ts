import type { BookDocument, DocumentTocNode } from "../../domain/book-document.types";
import { ReaderToolException } from "../../domain/reader-tool-error";
import { BookDocumentLoader } from "../book-document.loader";
import { contentRevisionKey, decodeCursor, encodeCursor } from "../reader-tool.utils";
import { resolveTocNodeRange } from "../toc-node-range.resolver";
import { buildTocTreeEntries } from "../toc-tree.builder";

interface TocCursor {
  tool: "book_toc";
  bookId: number;
  revision: string;
  mode: "outline";
  offset: number;
}

type TocMode = "outline" | "tree" | "navigation";

interface GetBookTocInput {
  mode: TocMode;
  cursor?: string;
  limit?: number;
  nodeIds?: string[];
}

export class GetBookTocUseCase {
  constructor(private readonly documentLoader: BookDocumentLoader) {}

  async execute(userId: number, bookId: number, input: GetBookTocInput) {
    const document = await this.documentLoader.load(userId, bookId);
    this.validateRequest(input);

    if (input.mode === "tree") {
      return this.getTree(bookId, document);
    }

    if (input.mode === "navigation") {
      return this.selectNavigationNodes(bookId, document, input.nodeIds);
    }

    let offset = 0;
    if (input.cursor) {
      const state = decodeCursor<TocCursor>(input.cursor, (value) =>
        value.tool === "book_toc"
        && value.bookId === bookId
        && value.revision === contentRevisionKey(document.revision)
        && value.mode === "outline"
        && Number.isInteger(value.offset)
        && Number(value.offset) >= 0,
      );
      if (!state) throw new ReaderToolException("CURSOR_INVALID", "TOC cursor is invalid or stale", "cursor");
      offset = state.offset;
    }
    const limit = input.limit ?? 100;
    const entries = document.toc
      .slice(offset, offset + limit)
      .map((node) => this.toFlatEntry(document, node, false));
    const nextOffset = offset + entries.length;
    const hasMore = nextOffset < document.toc.length;
    return {
      bookId,
      contentRevision: document.revision,
      tocQuality: document.tocQuality,
      entries,
      nextCursor: hasMore
        ? encodeCursor({
            tool: "book_toc",
            bookId,
            revision: contentRevisionKey(document.revision),
            mode: "outline",
            offset: nextOffset,
          })
        : null,
      hasMore,
    };
  }

  private validateRequest(input: GetBookTocInput) {
    if (input.mode === "navigation") {
      if (!input.nodeIds) {
        throw new ReaderToolException(
          "TOC_REQUEST_INVALID",
          "navigation mode requires nodeIds copied from a current outline response",
          "nodeIds",
        );
      }
      if (input.cursor !== undefined || input.limit !== undefined) {
        throw new ReaderToolException(
          "TOC_REQUEST_INVALID",
          "navigation mode only accepts nodeIds and cannot be combined with cursor or limit",
          input.cursor !== undefined ? "cursor" : "limit",
        );
      }
      return;
    }

    if (input.mode === "tree") {
      if (input.cursor !== undefined || input.limit !== undefined || input.nodeIds !== undefined) {
        throw new ReaderToolException(
          "TOC_REQUEST_INVALID",
          "tree mode returns the complete TOC and cannot be combined with cursor, limit, or nodeIds",
          input.cursor !== undefined ? "cursor" : input.limit !== undefined ? "limit" : "nodeIds",
        );
      }
      return;
    }

    if (input.nodeIds !== undefined) {
      throw new ReaderToolException(
        "TOC_REQUEST_INVALID",
        "outline mode does not accept nodeIds; use navigation mode to resolve selected chapter locators",
        "nodeIds",
      );
    }
  }

  private selectNavigationNodes(
    bookId: number,
    document: BookDocument,
    nodeIds: string[] | undefined,
  ) {
    if (!nodeIds) throw new ReaderToolException("TOC_REQUEST_INVALID", "navigation mode requires nodeIds", "nodeIds");
    const selectedIds = new Set(nodeIds);
    const nodesById = new Map(document.toc.map((node) => [node.nodeId, node]));
    const missingNodeId = nodeIds.find((nodeId) => !nodesById.has(nodeId));
    if (missingNodeId) {
      throw new ReaderToolException(
        "TOC_NODE_NOT_FOUND",
        `TOC node '${missingNodeId}' is no longer available. Refresh the outline and select a current nodeId.`,
        "nodeIds",
      );
    }
    return {
      bookId,
      contentRevision: document.revision,
      tocQuality: document.tocQuality,
      entries: document.toc
        .filter((node) => selectedIds.has(node.nodeId))
        .map((node) => this.toFlatEntry(document, node, true)),
      nextCursor: null,
      hasMore: false,
    };
  }

  private getTree(bookId: number, document: BookDocument) {
    if (document.toc.length > 200) {
      throw new ReaderToolException(
        "TOC_TREE_TOO_LARGE",
        `TOC has ${document.toc.length} nodes. Tree mode is limited to 200 nodes; use mode=outline with cursor pagination instead.`,
        "mode",
      );
    }

    return {
      bookId,
      contentRevision: document.revision,
      tocQuality: document.tocQuality,
      entries: buildTocTreeEntries(document),
      nextCursor: null,
      hasMore: false,
    };
  }

  private toFlatEntry(
    document: BookDocument,
    node: DocumentTocNode,
    includeStartLocator: boolean,
  ) {
    const outlineEntry = {
      nodeId: node.nodeId,
      parentNodeId: node.parentNodeId,
      linearIndex: node.linearIndex,
      level: node.level,
      label: node.label,
      path: node.path,
      ownCharCount: node.ownCharCount,
      subtreeCharCount: node.subtreeCharCount,
      hasChildren: node.hasChildren,
    };
    if (!includeStartLocator) return outlineEntry;
    const range = resolveTocNodeRange(document, node.nodeId, "nodeIds");
    return {
      ...outlineEntry,
      startLocator: range.startLocator,
      endLocator: range.endLocator,
    };
  }
}
