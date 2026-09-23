import type { AgentRunWriteAuthority } from "./agent-run-store.port";
import type { BookCitation } from "../../domain";

export interface PersistedEvidenceRecord {
  evidenceId: string;
  taskId: string;
  agentRunId: string;
  quote: string;
  citation: BookCitation;
  sourceTextHash: string;
  sourceLocator?: unknown;
  provenanceKind?: "read" | "conversation_import";
  sourceTaskId?: string;
  sourceEvidenceId?: string;
  createdAt: string;
}

export interface EvidenceStorePort {
  append(record: PersistedEvidenceRecord, authority: AgentRunWriteAuthority):
    "inserted" | "existing" | "fenced";
  listForTask(taskId: string): PersistedEvidenceRecord[];
  findForTask(taskId: string, evidenceId: string): PersistedEvidenceRecord | null;
  findImportedForTask(
    taskId: string,
    sourceTaskId: string,
    sourceEvidenceId: string,
  ): PersistedEvidenceRecord | null;
}
