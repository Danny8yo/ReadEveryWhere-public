import type { QaStructuredBookPort, QaStructureNode } from "../qa-structured-book.port";
import type { QaReadingEnvironment } from "./qa-reading-tools";
import { qaKeys, type QaRegisteredTool } from "./qa-tool-registry";
import { SelectionQaError } from "../selection-qa.types";
import { qaEvidenceResult } from "../qa-evidence";
import { qaReadingObservation } from "./qa-reading-tools";
import { qaAwait } from "../runtime/qa-await";

export function createQaStructureTools(env: QaReadingEnvironment, books: QaStructuredBookPort): QaRegisteredTool[] {
  const { claim, ledger, store, currentBook } = env;
  const nodes = new Map<string, QaStructureNode>();
  const pages = new Map<number, number>();
  let total: number | undefined;
  const nullableCursor = { type: ["string", "null"], maxLength: 300000 };
  const define = (name: string, description: string, properties: Record<string, unknown>) => ({ type: "function" as const,
    function: { name, description, strict: true as const, parameters: { type: "object", properties, required: Object.keys(properties), additionalProperties: false } } });
  const invalid = (): never => { throw new SelectionQaError("TOOL_ARGUMENTS_INVALID", 409, { constraint: "Copy a discovered node ID or the exact continuation cursor; use one start/continuation mode" }); };
  const validateCursor = (cursor: unknown): string | undefined => {
    if (cursor === null) return undefined;
    if (typeof cursor !== "string" || !cursor || cursor.length > 300000) invalid();
    return cursor as string;
  };
  const reading = (range: boolean): QaRegisteredTool => ({
    kind: "reading", operation: range ? "book_read_node" : "book_read_from_toc",
    definition: () => define(range ? "book_read_node" : "book_read_from_toc",
      range ? "Read a bounded portion of a discovered chapter, including chapters too large for TOC batches. Start with nodeId and null cursor; continue with null nodeId and the exact cursor. The host preserves the chapter end. Inspect verified coverage and gaps; the last cursor alone does not prove prior batches were read."
        : "Read complete TOC units in a batch, deduplicating parent/child selections. Start with nodeIds and null cursor; continue with empty nodeIds and exact cursor. Large indivisible units remain unavailable: explicitly use book_read_node for those chapters. Complete units are never silently truncated.",
      range ? { nodeId: { type: ["string", "null"], maxLength: 256 }, cursor: nullableCursor, maxChars: { type: "integer", minimum: 1, maximum: 10000 } }
        : { nodeIds: { type: "array", maxItems: 200, items: { type: "string", maxLength: 256 } }, cursor: nullableCursor }),
    fingerprint: args => JSON.stringify(args),
    execute: async (args, signal, deadline) => {
      qaKeys(args, range ? ["nodeId", "cursor", "maxChars"] : ["nodeIds", "cursor"]);
      const cursor = validateCursor(args.cursor);
      const nodeIds = range ? (args.nodeId === null ? [] : [args.nodeId]) : args.nodeIds;
      if (!Array.isArray(nodeIds) || nodeIds.length > 200 || Boolean(cursor) === Boolean(nodeIds.length) || nodeIds.some(id => typeof id !== "string" || !nodes.has(id))) invalid();
      if (range && (!Number.isSafeInteger(args.maxChars) || Number(args.maxChars) < 1 || Number(args.maxChars) > 10000)) invalid();
      const maxChars = Math.min(range ? Number(args.maxChars) : 50000, store.remaining(claim).chars);
      if (!maxChars) return { observationStatus: "not_executed", data: { reason: "READ_BUDGET_EXHAUSTED" } };
      const base = { maxChars, signal, deadline, ...(cursor ? { cursor } : {}) };
      const result = await qaAwait(() => range
        ? books.readNode(claim.turn.userId, claim.conversation.selection, { ...base, ...(!cursor ? { nodeId: (nodeIds as string[])[0] } : {}) })
        : books.readBatch(claim.turn.userId, claim.conversation.selection, { ...base, ...(!cursor ? { nodeIds: nodeIds as string[] } : {}) }), signal);
      if (result.notExecuted) return { observationStatus: "not_executed", data: { reason: result.notExecuted, unavailable: result.unavailable, instruction: "Use a smaller explicit chapter range or deliver the unresolved limit." } };
      if (result.readChars > maxChars || result.readChars < result.candidates.reduce((n, e) => n + e.quote.length, 0)) throw new SelectionQaError("EVIDENCE_INVALID");
      result.candidates.forEach(e => ledger.validate(e));
      store.chargeRead(claim, result.readChars);
      result.targets.forEach(t => ledger.coverage.target(t.nodeId, t.ranges));
      result.unavailable.forEach(gap => ledger.coverage.limitation(gap));
      const results = result.candidates.map(e => qaEvidenceResult(ledger.save(e), currentBook));
      const data = { sourceBook: currentBook, resultCount: results.length, results, nextCursor: result.nextCursor,
        unavailable: result.unavailable, readChars: result.readChars, runCoverage: ledger.coverage.snapshot() };
      return { observationStatus: results.length ? "success" : "empty", data, modelObservation: qaReadingObservation(results, data), progress: JSON.stringify(data.runCoverage) };
    },
  });
  return [{
    kind: "reading", operation: "book_toc",
    definition: () => define("book_toc", "Discover CURRENT_BOOK TOC in bounded pages of 100 nodes. Start with null cursor, then copy nextCursor. Nodes retain original hierarchy, source and canonical boundaries. Complete discovery is host-verified only after every page is acquired; reading titles is not reading the chapters.", { cursor: nullableCursor }),
    fingerprint: args => JSON.stringify(args),
    execute: async (args, signal, deadline) => {
      qaKeys(args, ["cursor"]);
      const cursor = validateCursor(args.cursor);
      const result = await qaAwait(() => books.discover(claim.turn.userId, claim.conversation.selection, { cursor, signal, deadline }), signal);
      if (total !== undefined && total !== result.totalNodes) throw new SelectionQaError("STRUCTURE_INVALID");
      total = result.totalNodes;
      if (result.entries.length > 100 || result.entries.some((n, i) => n.linearIndex !== result.offset + i)) throw new SelectionQaError("STRUCTURE_INVALID");
      result.entries.forEach(node => {
        const previous = nodes.get(node.nodeId);
        if (previous && JSON.stringify(previous) !== JSON.stringify(node)) throw new SelectionQaError("STRUCTURE_INVALID");
        nodes.set(node.nodeId, node);
      });
      pages.set(result.offset, result.entries.length);
      let offset = 0;
      for (const [from, count] of [...pages].sort((a, b) => a[0] - b[0])) {
        if (from !== offset) break;
        offset += count;
      }
      const complete = offset === total && nodes.size === total;
      const data = { ...result, discoveredNodes: nodes.size, complete, notice: "TOC discovery is not chapter reading or semantic evidence." };
      return { observationStatus: result.entries.length ? "success" : "empty", data, progress: JSON.stringify({ nodeIds: result.entries.map(n => n.nodeId), complete }) };
    },
  }, reading(false), reading(true)];
}
