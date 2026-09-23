import { DatabaseSync } from "node:sqlite";
/** Deterministic synthetic records only; never reads a workspace database. */
export function seedUpgradeFixture(db: DatabaseSync): void {
  const insert = (
    table: string,
    values: Record<string, string | number | null>,
  ) => {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    const row = { ...values };
    for (const column of columns) {
      const name = String(column.name);
      if (!(name in row) && column.notnull === 1 && column.dflt_value === null)
        row[name] = column.type === "INTEGER" ? 1 : "fixture";
    }
    const names = Object.keys(row);
    db.prepare(
      `INSERT INTO ${table}(${names.join(",")}) VALUES(${names.map(() => "?").join(",")})`,
    ).run(...Object.values(row));
  };
  insert("users", { id: 1, email: "fixture@example.test" });
  insert("books", { id: 1, user_id: 1, authors_json: '["Author"]' });
  insert("book_artifacts", {
    artifact_id: "artifact",
    delivery_id: "delivery",
    user_id: 1,
    book_id: 1,
    status: "active",
    checksum: "checksum",
  });
  insert("book_current_artifacts", { book_id: 1, artifact_id: "artifact" });
  insert("annotations", {
    id: "annotation",
    user_id: 1,
    book_id: 1,
    note: "保留原始批注",
    annotation_type: "highlight",
    location_type: "epubcfi",
  });
  insert("reading_state_versions", { user_id: 1, book_id: 1, revision: 7 });
  insert("book_profiles", { book_id: 1, primary_genre: "fiction" });
  insert("reading_conversations", {
    id: "old-conversation",
    user_id: 1,
    book_id: 1,
    status: "active",
    profile_snapshot_json: "{}",
  });
  insert("ai_reading_tasks", {
    id: "v1-task",
    user_id: 1,
    book_id: 1,
    schema_version: 1,
    state_json: "{}",
    status: "completed",
  });
  insert("ai_reading_evidence", {
    evidence_id: "old-evidence",
    task_id: "v1-task",
    citation_json: "{}",
  });
}
export function snapshotLegacy(db: DatabaseSync): Record<string, unknown> {
  return Object.fromEntries(
    db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'selection_qa_%' AND name NOT LIKE 'content_index_%' AND name NOT IN ('schema_migrations','annotation_selection_commands','refresh_tokens','auth_sessions') ORDER BY name",
      )
      .all()
      .map((row) => [
        String(row.name),
        db.prepare(`SELECT * FROM ${String(row.name)} ORDER BY rowid`).all(),
      ]),
  );
}
