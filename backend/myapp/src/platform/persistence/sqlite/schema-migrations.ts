import { AUTH_SESSIONS_SCHEMA } from "./schema-auth-sessions";
import { SELECTION_QA_RUNTIME_SCHEMA } from "./schema-selection-qa-runtime";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { BASELINE_SCHEMA } from "./schema-baseline";
import { CURRENT_BASE_SCHEMA } from "./schema-current";
import { SELECTION_QA_SCHEMA } from "./schema-selection-qa";

import { KEYWORD_INDEX_SCHEMA } from "./schema-index";

import { KEYWORD_INDEX_FILES_SCHEMA } from "./schema-index-files";
import { SELECTION_QA_REPAIR_BUDGET_SCHEMA } from "./schema-selection-qa-repair-budget";
import { SELECTION_QA_HISTORY_SCHEMA } from "./schema-selection-qa-history";
import { SELECTION_QA_AUTONOMY_SCHEMA } from "./schema-selection-qa-autonomy";
import { SELECTION_QA_QUALITY_SCHEMA } from "./schema-selection-qa-quality";
import { KEYWORD_INDEX_DUAL_FORMAT_SCHEMA } from "./schema-index-dual-format";

const migrations = [BASELINE_SCHEMA, SELECTION_QA_SCHEMA, KEYWORD_INDEX_SCHEMA, SELECTION_QA_RUNTIME_SCHEMA, KEYWORD_INDEX_FILES_SCHEMA, SELECTION_QA_REPAIR_BUDGET_SCHEMA, AUTH_SESSIONS_SCHEMA, SELECTION_QA_HISTORY_SCHEMA, SELECTION_QA_AUTONOMY_SCHEMA, SELECTION_QA_QUALITY_SCHEMA, KEYWORD_INDEX_DUAL_FORMAT_SCHEMA];
// Explicitly recognized historical extension. Only applied to in-memory reference
// schemas: existing columns, values and uniqueness constraints are preserved.
const historicalSourceChecksum = `
ALTER TABLE book_artifacts ADD COLUMN source_checksum TEXT;
CREATE UNIQUE INDEX uq_book_artifacts_active_source_checksum
        ON book_artifacts(user_id, source_checksum)
        WHERE status = 'active' AND source_checksum IS NOT NULL;
`;
function checksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}
function signature(db: DatabaseSync): string {
  const objects = db
    .prepare(
      "SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' ORDER BY name",
    )
    .all();
  return JSON.stringify(
    objects.map((row) => {
      const name = String(row.name);
      if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(name))
        throw new Error("Unsupported schema identifier");
      if (row.type !== "table")
        return { ...row, sql: String(row.sql).replace(/\s+/g, " ").trim() };
      const columns = db
        .prepare(`PRAGMA table_info(${name})`)
        .all()
        .map(({ cid, ...column }) => column)
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
      return {
        type: row.type,
        name,
        sql: String(row.sql).replace(/\s+/g, " ").trim(),
        columns,
        foreignKeys: db.prepare(`PRAGMA foreign_key_list(${name})`).all(),
      };
    }),
  );
}
function assertSchema(db: DatabaseSync, version: number): void {
  const suffix = migrations.slice(1, version).join("\n");
  const actual = signature(db);
  for (const base of [BASELINE_SCHEMA, CURRENT_BASE_SCHEMA, BASELINE_SCHEMA + historicalSourceChecksum]) {
    const expected = new DatabaseSync(":memory:");
    try {
      expected.exec(base + suffix);
      if (actual === signature(expected)) return;
    } finally {
      expected.close();
    }
  }
  throw new Error(
    "Unsupported SQLite schema: expected the documented 2026-09-10 baseline; no changes applied",
  );
}
export function initializeSchema(
  db: DatabaseSync,
  afterMigration?: (version: number) => void,
): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .all();
    const hasLedger = tables.some((row) => row.name === "schema_migrations");
    let applied = 0;
    if (hasLedger) {
      const rows = db
        .prepare(
          "SELECT version,checksum FROM schema_migrations ORDER BY version",
        )
        .all();
      rows.forEach((row, index) => {
        if (
          row.version !== index + 1 ||
          index >= migrations.length ||
          row.checksum !== checksum(migrations[index])
        )
          throw new Error("Unsupported or modified SQLite migration ledger");
      });
      applied = rows.length;
      if (applied < 1) throw new Error("Incomplete SQLite migration ledger");
      assertSchema(db, applied);
    } else {
      if (tables.length === 0) db.exec(CURRENT_BASE_SCHEMA);
      else assertSchema(db, 1);
      db.exec(
        "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)",
      );
      db.prepare("INSERT INTO schema_migrations VALUES(?,?,?)").run(
        1,
        checksum(migrations[0]),
        Date.now(),
      );
      applied = 1;
    }
    for (let index = applied; index < migrations.length; index++) {
      db.exec(migrations[index]);
      afterMigration?.(index + 1);
      db.prepare("INSERT INTO schema_migrations VALUES(?,?,?)").run(
        index + 1,
        checksum(migrations[index]),
        Date.now(),
      );
    }
    if (db.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("SQLite foreign key validation failed");
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}
