import type { QaEvidence } from "./selection-qa-runtime.port";
import type { SelectionSnapshot } from "./selection-qa.types";
export interface QaStructureNode {
  nodeId: string; parentNodeId: string | null; linearIndex: number; level: number; label: string; path: string;
  ownCharCount: number; subtreeCharCount: number; hasChildren: boolean;
  start: { sectionIndex: number; offset: number }; end: { sectionIndex: number; offset: number };
}
export interface QaStructurePage {
  entries: QaStructureNode[]; totalNodes: number; offset: number; tocQuality: string;
  provenance: Record<string, string | number>; nextCursor: string | null;
}
export interface QaStructuredRead {
  candidates: QaEvidence[]; targets: Array<{ nodeId: string; ranges: Array<{ sectionIndex: number; href: string; start: number; end: number }> }>;
  unavailable: Array<Record<string, unknown>>; nextCursor: string | null; readChars: number; notExecuted?: "READ_BUDGET_EXHAUSTED";
}
export interface QaStructuredBookPort {
  discover(userId: number, selection: SelectionSnapshot, input: { cursor?: string; signal: AbortSignal; deadline: number }): Promise<QaStructurePage>;
  readBatch(userId: number, selection: SelectionSnapshot, input: { nodeIds?: string[]; cursor?: string; maxChars: number; signal: AbortSignal; deadline: number }): Promise<QaStructuredRead>;
  readNode(userId: number, selection: SelectionSnapshot, input: { nodeId?: string; cursor?: string; maxChars: number; signal: AbortSignal; deadline: number }): Promise<QaStructuredRead>;
}
