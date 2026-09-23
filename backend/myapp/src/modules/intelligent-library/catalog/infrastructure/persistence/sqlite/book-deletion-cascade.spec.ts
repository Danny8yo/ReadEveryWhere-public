import { LibrarySyncState } from "../../../../library-sync/library-sync-state";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { SqliteService } from "../../../../../../platform/persistence/sqlite/sqlite.service";
import { SqliteBookRepository } from "./sqlite-book.repository";

const USER_ID = 7;
const BOOK_ID = 42;
const NOW = "2026-08-26T00:00:00.000Z";

const CASCADED_TABLES = [
  "source_refs",
  "book_current_artifacts",
  "book_douban_ratings",
  "book_profiles",
  "book_analysis_candidates",
  "book_analysis_tasks",
  "download_tasks",
  "annotations",
  "reading_progress",
  "bookmarks",
  "ai_reading_tasks",
  "reading_conversations",
  "reading_conversation_turns",
  "reading_conversation_checkpoints",
  "ai_reading_agent_runs",
  "ai_reading_agent_steps",
  "ai_reading_task_budgets",
  "ai_reading_budget_reservations",
  "ai_reading_messages",
  "ai_reading_events",
  "ai_reading_evidence",
  "ai_reading_audit",
] as const;

describe("SqliteBookRepository deletion cascade", () => {
  let directory: string;
  let sqlite: SqliteService;
  let repository: SqliteBookRepository;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "book-delete-cascade-"));
    process.env.SQLITE_PATH = join(directory, "test.sqlite");
    sqlite = new SqliteService();
    sqlite.onModuleInit();
    repository = new SqliteBookRepository(sqlite, new LibrarySyncState());
    seedBookGraph(sqlite.getDatabase());
  });

  afterEach(() => {
    sqlite.onApplicationShutdown();
    delete process.env.SQLITE_PATH;
    rmSync(directory, { recursive: true, force: true });
  });

  it("does not delete a book owned by another user", () => {
    expect(repository.delete(8, BOOK_ID)).toBe(false);
    expect(count(sqlite.getDatabase(), "books")).toBe(1);
    for (const table of CASCADED_TABLES) expect(count(sqlite.getDatabase(), table)).toBe(1);
  });

  it("cascades every direct and AI-reading descendant when the owned book is deleted", () => {
    for (const table of CASCADED_TABLES) expect(count(sqlite.getDatabase(), table)).toBe(1);

    expect(repository.delete(USER_ID, BOOK_ID)).toBe(true);

    expect(count(sqlite.getDatabase(), "books")).toBe(0);
    for (const table of CASCADED_TABLES) expect(count(sqlite.getDatabase(), table)).toBe(0);
  });
});

function seedBookGraph(database: DatabaseSync): void {
  insertMinimal(database, "users", {
    id: USER_ID,
    email: "cascade@example.com",
    password_hash: "hash",
    created_at: NOW,
    updated_at: NOW,
  });
  insertMinimal(database, "books", {
    id: BOOK_ID,
    user_id: USER_ID,
    title: "Cascade Book",
    title_normalized: "cascadebook",
    authors_json: "[]",
    authors_text: "",
    version: 1,
    created_at: NOW,
    updated_at: NOW,
  });

  insertMinimal(database, "book_artifacts", {
    artifact_id: "artifact-42",
    delivery_id: "delivery-42",
    user_id: USER_ID,
    book_id: BOOK_ID,
    status: "active",
    stored_path: "7/artifacts/book.epub",
    file_name: "book.epub",
    mime_type: "application/epub+zip",
    file_size: 1,
    checksum: "checksum-42",
    managed: 1,
    created_at: NOW,
    updated_at: NOW,
  });
  insertMinimal(database, "book_current_artifacts", {
    book_id: BOOK_ID,
    artifact_id: "artifact-42",
    activated_at: NOW,
  });

  for (const table of [
    "source_refs", "book_profiles", "book_douban_ratings", "book_analysis_candidates", "book_analysis_tasks",
    "download_tasks", "annotations", "reading_progress", "bookmarks",
  ]) insertMinimal(database, table, { user_id: USER_ID, book_id: BOOK_ID });

  insertMinimal(database, "ai_reading_tasks", {
    id: "task-1", user_id: USER_ID, book_id: BOOK_ID, schema_version: 2,
  });
  insertMinimal(database, "reading_conversations", {
    id: "conversation-1", user_id: USER_ID, book_id: BOOK_ID,
  });
  insertMinimal(database, "reading_conversation_turns", {
    id: "turn-1", conversation_id: "conversation-1", task_id: "task-1",
  });
  insertMinimal(database, "reading_conversation_checkpoints", {
    id: "checkpoint-1", conversation_id: "conversation-1", through_turn_id: "turn-1",
  });
  insertMinimal(database, "ai_reading_agent_runs", {
    id: "run-1", task_id: "task-1",
  });
  insertMinimal(database, "ai_reading_agent_steps", {
    id: "step-1", task_id: "task-1", agent_run_id: "run-1",
  });
  insertMinimal(database, "ai_reading_task_budgets", { task_id: "task-1" });
  insertMinimal(database, "ai_reading_budget_reservations", {
    id: "reservation-1", task_id: "task-1", agent_run_id: "run-1", step_id: "step-1",
  });
  insertMinimal(database, "ai_reading_messages", { task_id: "task-1", agent_run_id: "run-1" });
  insertMinimal(database, "ai_reading_events", { task_id: "task-1", sequence: 1 });
  insertMinimal(database, "ai_reading_evidence", {
    evidence_id: "evidence-1", task_id: "task-1", agent_run_id: "run-1",
  });
  insertMinimal(database, "ai_reading_audit", { task_id: "task-1", agent_run_id: "run-1" });
}

function insertMinimal(database: DatabaseSync, table: string, overrides: Record<string, any>): void {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: unknown;
    pk: number;
  }>;
  const values = new Map<string, any>();
  for (const column of columns) {
    if (Object.prototype.hasOwnProperty.call(overrides, column.name)) {
      values.set(column.name, overrides[column.name]);
    } else if (column.notnull && column.dflt_value === null) {
      if (column.pk && column.type.toUpperCase() === "INTEGER") continue;
      values.set(column.name, /INT|REAL|NUM/.test(column.type.toUpperCase()) ? 1 : `${table}-${column.name}`);
    }
  }
  const names = [...values.keys()];
  database.prepare(
    `INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
  ).run(...values.values());
}

function count(database: DatabaseSync, table: string): number {
  const row = database.prepare(`SELECT COUNT(1) AS count FROM ${table}`).get() as unknown as { count: number };
  return Number(row.count);
}
