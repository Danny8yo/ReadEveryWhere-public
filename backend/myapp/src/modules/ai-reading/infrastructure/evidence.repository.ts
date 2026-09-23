import { Injectable } from "@nestjs/common";
import type { DatabaseSync } from "node:sqlite";
import { SqliteService } from "../../../platform/persistence/sqlite/sqlite.service";
import type { AgentRunWriteAuthority } from "../application/ports/agent-run-store.port";
import type { EvidenceStorePort, PersistedEvidenceRecord } from "../application/ports/evidence-store.port";

interface EvidenceRow {
  evidence_id: string;
  task_id: string;
  agent_run_id: string;
  quote: string;
  citation_json: string;
  source_text_hash: string;
  source_locator_json: string | null;
  provenance_kind: "read" | "conversation_import" | null;
  source_task_id: string | null;
  source_evidence_id: string | null;
  created_at: string;
}

@Injectable()
export class EvidenceRepository implements EvidenceStorePort {
  constructor(private readonly sqliteService: SqliteService) {}

  append(record: PersistedEvidenceRecord, authority: AgentRunWriteAuthority): "inserted" | "existing" | "fenced" {
    const db = this.sqliteService.getDatabase();
    return transaction(db, () => {
      if (!canWrite(db, record.agentRunId, authority)) return "fenced";
      const existingById = db.prepare("SELECT * FROM ai_reading_evidence WHERE evidence_id = ?")
        .get(record.evidenceId) as unknown as EvidenceRow | undefined;
      if (existingById) {
        if (!sameEvidence(existingById, record)) throw new Error("EVIDENCE_ID_CONFLICT");
        return "existing";
      }
      if (record.sourceTaskId && record.sourceEvidenceId) {
        const existingImport = db.prepare(`SELECT * FROM ai_reading_evidence
          WHERE task_id = ? AND source_task_id = ? AND source_evidence_id = ?`)
          .get(record.taskId, record.sourceTaskId, record.sourceEvidenceId) as unknown as EvidenceRow | undefined;
        if (existingImport) return "existing";
      }
      db.prepare(`INSERT INTO ai_reading_evidence (evidence_id,task_id,agent_run_id,quote,citation_json,
        source_text_hash,source_locator_json,provenance_kind,source_task_id,source_evidence_id,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(record.evidenceId, record.taskId, record.agentRunId, record.quote, JSON.stringify(record.citation),
          record.sourceTextHash, record.sourceLocator ? JSON.stringify(record.sourceLocator) : null,
          record.provenanceKind ?? null, record.sourceTaskId ?? null, record.sourceEvidenceId ?? null,
          record.createdAt);
      return "inserted";
    });
  }

  listForTask(taskId: string): PersistedEvidenceRecord[] {
    const rows = this.sqliteService.getDatabase().prepare(`SELECT evidence_id,task_id,agent_run_id,quote,citation_json,
      source_text_hash,source_locator_json,provenance_kind,source_task_id,source_evidence_id,created_at
      FROM ai_reading_evidence WHERE task_id = ? ORDER BY created_at,evidence_id`)
      .all(taskId) as unknown as EvidenceRow[];
    return rows.map(toRecord);
  }

  findForTask(taskId: string, evidenceId: string): PersistedEvidenceRecord | null {
    const row = this.sqliteService.getDatabase().prepare(`SELECT evidence_id,task_id,agent_run_id,quote,citation_json,
      source_text_hash,source_locator_json,provenance_kind,source_task_id,source_evidence_id,created_at
      FROM ai_reading_evidence WHERE task_id = ? AND evidence_id = ?`)
      .get(taskId, evidenceId) as unknown as EvidenceRow | undefined;
    return row ? toRecord(row) : null;
  }

  findImportedForTask(
    taskId: string,
    sourceTaskId: string,
    sourceEvidenceId: string,
  ): PersistedEvidenceRecord | null {
    const row = this.sqliteService.getDatabase().prepare(`SELECT evidence_id,task_id,agent_run_id,quote,citation_json,
      source_text_hash,source_locator_json,provenance_kind,source_task_id,source_evidence_id,created_at
      FROM ai_reading_evidence WHERE task_id = ? AND source_task_id = ? AND source_evidence_id = ?`)
      .get(taskId, sourceTaskId, sourceEvidenceId) as unknown as EvidenceRow | undefined;
    return row ? toRecord(row) : null;
  }
}

function canWrite(db: DatabaseSync, runId: string, authority: AgentRunWriteAuthority): boolean {
  const lease = authority.lease;
  if (lease.agentRunId !== runId) return false;
  const row = db.prepare(`SELECT 1 AS allowed FROM ai_reading_agent_runs WHERE id = ? AND task_id IS NOT NULL
    AND lease_owner = ? AND lease_token = ? AND lease_generation = ? AND lease_expires_at > ?
    AND cancel_requested = 0 AND status = 'running'`)
    .get(runId, lease.workerId, lease.leaseToken, lease.generation, authority.now) as unknown as { allowed: number } | undefined;
  return Boolean(row);
}

function sameEvidence(row: EvidenceRow, record: PersistedEvidenceRecord): boolean {
  return row.task_id === record.taskId
    && row.agent_run_id === record.agentRunId
    && row.quote === record.quote
    && row.source_text_hash === record.sourceTextHash
    && row.citation_json === JSON.stringify(record.citation);
}

function toRecord(row: EvidenceRow): PersistedEvidenceRecord {
  return {
    evidenceId: row.evidence_id,
    taskId: row.task_id,
    agentRunId: row.agent_run_id,
    quote: row.quote,
    citation: JSON.parse(row.citation_json),
    sourceTextHash: row.source_text_hash,
    sourceLocator: row.source_locator_json ? JSON.parse(row.source_locator_json) : undefined,
    provenanceKind: row.provenance_kind ?? undefined,
    sourceTaskId: row.source_task_id ?? undefined,
    sourceEvidenceId: row.source_evidence_id ?? undefined,
    createdAt: row.created_at,
  };
}

function transaction<T>(db: DatabaseSync, action: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try { const result = action(); db.exec("COMMIT"); return result; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}
