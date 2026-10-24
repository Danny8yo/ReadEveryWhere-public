import type { ContentRevision } from "../book-content/domain/book-document.types";
import type { RetrievalScope, VerifiedBookEvidence } from "./book-retrieval.port";
export const BOOK_STRUCTURED_CONTENT_PORT = Symbol("BOOK_STRUCTURED_CONTENT_PORT");
export interface StructuredRange { sectionIndex: number; href: string; start: number; end: number }
export interface StructureNode {
  nodeId: string; parentNodeId: string | null; linearIndex: number; level: number; label: string; path: string;
  ownCharCount: number; subtreeCharCount: number; hasChildren: boolean;
  start: { sectionIndex: number; offset: number }; end: { sectionIndex: number; offset: number };
}
export interface StructurePage {
  contentRevision: ContentRevision; entries: StructureNode[]; totalNodes: number; offset: number;
  tocQuality: string; provenance: Record<string, string | number>; nextCursor: string | null;
}
export interface StructuredRead {
  candidates: VerifiedBookEvidence[];
  targets: Array<{ nodeId: string; ranges: StructuredRange[] }>;
  unavailable: Array<Record<string, unknown>>;
  nextCursor: string | null;
  readChars: number;
  notExecuted?: "READ_BUDGET_EXHAUSTED";
}
export interface BookStructuredContentPort {
  discover(userId: number, scope: RetrievalScope, input: { cursor?: string; signal: AbortSignal; deadline: number }): Promise<StructurePage>;
  readBatch(userId: number, scope: RetrievalScope, input: { nodeIds?: string[]; cursor?: string; maxChars: number; signal: AbortSignal; deadline: number }): Promise<StructuredRead>;
  readNode(userId: number, scope: RetrievalScope, input: { nodeId?: string; cursor?: string; maxChars: number; signal: AbortSignal; deadline: number }): Promise<StructuredRead>;
}
