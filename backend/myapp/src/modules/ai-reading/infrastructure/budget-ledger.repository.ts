import { Injectable } from "@nestjs/common";
import type { DatabaseSync } from "node:sqlite";
import { SqliteService } from "../../../platform/persistence/sqlite/sqlite.service";
import type {
  BudgetCounters, BudgetLedgerStorePort, BudgetReservationRequest, BudgetSettlement, TaskBudgetRecord,
} from "../application/ports/budget-ledger-store.port";
import type { AgentRunWriteAuthority } from "../application/ports/agent-run-store.port";

@Injectable()
export class BudgetLedgerRepository implements BudgetLedgerStorePort {
  constructor(private readonly sqliteService: SqliteService) {}

  create(record: TaskBudgetRecord): void {
    this.sqliteService.getDatabase().prepare(`INSERT INTO ai_reading_task_budgets (
      task_id,policy_json,deadline_at,used_model_turns,used_tool_calls,used_read_characters,used_delegated_agents,
      reserved_model_turns,reserved_tool_calls,reserved_read_characters,reserved_delegated_agents,
      prompt_tokens,completion_tokens,total_tokens,cache_read_input_tokens,cache_write_input_tokens,
      uncached_input_tokens,version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(record.taskId, JSON.stringify(record.policy), record.policy.deadlineAt,
        record.used.modelTurns, record.used.toolCalls, record.used.readCharacters, record.used.delegatedAgents,
        record.reserved.modelTurns, record.reserved.toolCalls, record.reserved.readCharacters,
        record.reserved.delegatedAgents, record.promptTokens, record.completionTokens, record.totalTokens,
        record.cacheReadInputTokens ?? null, record.cacheWriteInputTokens ?? null,
        record.uncachedInputTokens ?? null, record.version);
  }

  find(taskId: string): TaskBudgetRecord | null {
    const row = this.sqliteService.getDatabase().prepare("SELECT * FROM ai_reading_task_budgets WHERE task_id = ?")
      .get(taskId) as unknown as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      taskId, policy: JSON.parse(String(row.policy_json)),
      used: counters(row, "used"), reserved: counters(row, "reserved"),
      promptTokens: Number(row.prompt_tokens), completionTokens: Number(row.completion_tokens),
      totalTokens: Number(row.total_tokens),
      cacheReadInputTokens: nullableNumber(row.cache_read_input_tokens),
      cacheWriteInputTokens: nullableNumber(row.cache_write_input_tokens),
      uncachedInputTokens: nullableNumber(row.uncached_input_tokens),
      version: Number(row.version),
    };
  }

  reserve(request: BudgetReservationRequest, authority: AgentRunWriteAuthority):
    "reserved" | "existing" | "exhausted" | "deadline" | "fenced" {
    validateCounters(request.amount);
    const db = this.sqliteService.getDatabase();
    return transaction(db, () => {
      if (!canWrite(db, request.agentRunId, authority)) return "fenced";
      const existing = db.prepare(`SELECT id FROM ai_reading_budget_reservations
        WHERE agent_run_id = ? AND step_id = ? AND kind = ?`)
        .get(request.agentRunId, request.stepId, request.kind) as unknown as { id: string } | undefined;
      if (existing) return "existing";
      const budget = this.find(request.taskId);
      if (!budget) throw new Error("TASK_BUDGET_NOT_FOUND");
      if (request.now >= budget.policy.deadlineAt) return "deadline";
      const node = db.prepare(`SELECT used_model_turns,used_tool_calls,used_read_characters,used_delegated_agents,
        reserved_model_turns,reserved_tool_calls,reserved_read_characters,reserved_delegated_agents
        FROM ai_reading_agent_runs WHERE id = ? AND task_id = ? AND schema_version = 2`)
        .get(request.agentRunId, request.taskId) as unknown as Record<string, unknown> | undefined;
      if (!node) throw new Error("AGENT_RUN_NOT_FOUND");
      if (!fits(budget.used, budget.reserved, request.amount, budget.policy)
        || !fits(counters(node, "used"), counters(node, "reserved"), request.amount, {
          ...request.nodeLimits, delegatedAgents: budget.policy.delegatedAgents,
        })) return "exhausted";
      const amount = fullCounters(request.amount);
      db.prepare(`INSERT INTO ai_reading_budget_reservations (id,task_id,agent_run_id,step_id,kind,
        reserved_model_turns,reserved_tool_calls,reserved_read_characters,reserved_delegated_agents,status,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,'reserved',?)`)
        .run(request.id, request.taskId, request.agentRunId, request.stepId, request.kind,
          amount.modelTurns, amount.toolCalls, amount.readCharacters, amount.delegatedAgents, request.now);
      addReserved(db, "ai_reading_task_budgets", "task_id", request.taskId, amount);
      addReserved(db, "ai_reading_agent_runs", "id", request.agentRunId, amount);
      return "reserved";
    });
  }

  settle(reservationId: string, settlement: BudgetSettlement, authority: AgentRunWriteAuthority): boolean {
    validateCounters(settlement.amount);
    const db = this.sqliteService.getDatabase();
    return transaction(db, () => {
      const row = reservation(db, reservationId);
      if (!row) return false;
      if (!canWrite(db, String(row.agent_run_id), authority)) return false;
      if (row.status === "settled") return true;
      if (row.status !== "reserved") return false;
      const reserved = counters(row, "reserved");
      const actual = fullCounters(settlement.amount);
      if (!within(actual, reserved)) throw new Error("BUDGET_SETTLEMENT_EXCEEDS_RESERVATION");
      db.prepare(`UPDATE ai_reading_budget_reservations SET status='settled',actual_model_turns=?,actual_tool_calls=?,
        actual_read_characters=?,actual_delegated_agents=?,prompt_tokens=?,completion_tokens=?,total_tokens=?,
        cache_read_input_tokens=?,cache_write_input_tokens=?,uncached_input_tokens=?,settled_at=? WHERE id=?`)
        .run(actual.modelTurns, actual.toolCalls, actual.readCharacters, actual.delegatedAgents,
          settlement.promptTokens ?? 0, settlement.completionTokens ?? 0, settlement.totalTokens ?? 0,
          settlement.cacheReadInputTokens ?? null, settlement.cacheWriteInputTokens ?? null,
          settlement.uncachedInputTokens ?? null,
          settlement.settledAt, reservationId);
      settleCounters(db, "ai_reading_task_budgets", "task_id", String(row.task_id), reserved, actual,
        settlement.promptTokens ?? 0, settlement.completionTokens ?? 0, settlement.totalTokens ?? 0,
        settlement.cacheReadInputTokens, settlement.cacheWriteInputTokens, settlement.uncachedInputTokens);
      settleCounters(db, "ai_reading_agent_runs", "id", String(row.agent_run_id), reserved, actual,
        settlement.promptTokens ?? 0, settlement.completionTokens ?? 0, settlement.totalTokens ?? 0,
        settlement.cacheReadInputTokens, settlement.cacheWriteInputTokens, settlement.uncachedInputTokens);
      return true;
    });
  }

  release(reservationId: string, settledAt: string, authority: AgentRunWriteAuthority): boolean {
    const db = this.sqliteService.getDatabase();
    return transaction(db, () => {
      const row = reservation(db, reservationId);
      if (!row) return false;
      if (!canWrite(db, String(row.agent_run_id), authority)) return false;
      if (row.status === "released") return true;
      if (row.status !== "reserved") return false;
      const reserved = counters(row, "reserved");
      db.prepare("UPDATE ai_reading_budget_reservations SET status='released',settled_at=? WHERE id=?")
        .run(settledAt, reservationId);
      subtractReserved(db, "ai_reading_task_budgets", "task_id", String(row.task_id), reserved);
      subtractReserved(db, "ai_reading_agent_runs", "id", String(row.agent_run_id), reserved);
      return true;
    });
  }
}

function counters(row: Record<string, unknown>, prefix: "used" | "reserved"): BudgetCounters {
  return { modelTurns: Number(row[`${prefix}_model_turns`] ?? 0), toolCalls: Number(row[`${prefix}_tool_calls`] ?? 0),
    readCharacters: Number(row[`${prefix}_read_characters`] ?? 0),
    delegatedAgents: Number(row[`${prefix}_delegated_agents`] ?? 0) };
}
function fullCounters(value: Partial<BudgetCounters>): BudgetCounters {
  return { modelTurns: value.modelTurns ?? 0, toolCalls: value.toolCalls ?? 0,
    readCharacters: value.readCharacters ?? 0, delegatedAgents: value.delegatedAgents ?? 0 };
}
function validateCounters(value: Partial<BudgetCounters>): void {
  if (Object.values(value).some((item) => !Number.isSafeInteger(item) || Number(item) < 0)) {
    throw new Error("INVALID_BUDGET_AMOUNT");
  }
}
function fits(used: BudgetCounters, reserved: BudgetCounters, amount: Partial<BudgetCounters>, limits: BudgetCounters): boolean {
  const delta = fullCounters(amount);
  return (Object.keys(delta) as Array<keyof BudgetCounters>)
    .every((key) => used[key] + reserved[key] + delta[key] <= limits[key]);
}
function within(actual: BudgetCounters, reserved: BudgetCounters): boolean {
  return (Object.keys(actual) as Array<keyof BudgetCounters>).every((key) => actual[key] <= reserved[key]);
}
function reservation(db: DatabaseSync, id: string): Record<string, unknown> | undefined {
  return db.prepare("SELECT * FROM ai_reading_budget_reservations WHERE id = ?").get(id) as unknown as Record<string, unknown> | undefined;
}
function canWrite(db: DatabaseSync, runId: string, authority: AgentRunWriteAuthority): boolean {
  const lease = authority.lease;
  if (lease.agentRunId !== runId) return false;
  const row = db.prepare(`SELECT 1 AS allowed FROM ai_reading_agent_runs WHERE id = ? AND lease_owner = ?
    AND lease_token = ? AND lease_generation = ? AND lease_expires_at > ? AND cancel_requested = 0`)
    .get(runId, lease.workerId, lease.leaseToken, lease.generation, authority.now) as unknown as { allowed: number } | undefined;
  return Boolean(row);
}
function addReserved(db: DatabaseSync, table: string, idColumn: string, id: string, value: BudgetCounters): void {
  db.prepare(`UPDATE ${table} SET reserved_model_turns=reserved_model_turns+?,reserved_tool_calls=reserved_tool_calls+?,
    reserved_read_characters=reserved_read_characters+?,reserved_delegated_agents=reserved_delegated_agents+?
    WHERE ${idColumn}=?`).run(value.modelTurns, value.toolCalls, value.readCharacters, value.delegatedAgents, id);
}
function subtractReserved(db: DatabaseSync, table: string, idColumn: string, id: string, value: BudgetCounters): void {
  db.prepare(`UPDATE ${table} SET reserved_model_turns=reserved_model_turns-?,reserved_tool_calls=reserved_tool_calls-?,
    reserved_read_characters=reserved_read_characters-?,reserved_delegated_agents=reserved_delegated_agents-?
    WHERE ${idColumn}=?`).run(value.modelTurns, value.toolCalls, value.readCharacters, value.delegatedAgents, id);
}
function settleCounters(db: DatabaseSync, table: string, idColumn: string, id: string, reserved: BudgetCounters,
  actual: BudgetCounters, prompt: number, completion: number, total: number,
  cacheRead?: number | null, cacheWrite?: number | null, uncached?: number | null): void {
  db.prepare(`UPDATE ${table} SET reserved_model_turns=reserved_model_turns-?,reserved_tool_calls=reserved_tool_calls-?,
    reserved_read_characters=reserved_read_characters-?,reserved_delegated_agents=reserved_delegated_agents-?,
    used_model_turns=used_model_turns+?,used_tool_calls=used_tool_calls+?,used_read_characters=used_read_characters+?,
    used_delegated_agents=used_delegated_agents+?,prompt_tokens=prompt_tokens+?,completion_tokens=completion_tokens+?,
    total_tokens=total_tokens+?,
    cache_read_input_tokens=CASE WHEN ? IS NULL THEN cache_read_input_tokens ELSE COALESCE(cache_read_input_tokens,0)+? END,
    cache_write_input_tokens=CASE WHEN ? IS NULL THEN cache_write_input_tokens ELSE COALESCE(cache_write_input_tokens,0)+? END,
    uncached_input_tokens=CASE WHEN ? IS NULL THEN uncached_input_tokens ELSE COALESCE(uncached_input_tokens,0)+? END
    WHERE ${idColumn}=?`)
    .run(reserved.modelTurns, reserved.toolCalls, reserved.readCharacters, reserved.delegatedAgents,
      actual.modelTurns, actual.toolCalls, actual.readCharacters, actual.delegatedAgents, prompt, completion, total,
      cacheRead ?? null, cacheRead ?? null, cacheWrite ?? null, cacheWrite ?? null,
      uncached ?? null, uncached ?? null, id);
}
function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}
function transaction<T>(db: DatabaseSync, action: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try { const result = action(); db.exec("COMMIT"); return result; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}
