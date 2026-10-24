import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BASELINE_SCHEMA } from "./schema-baseline";
import { SELECTION_QA_SCHEMA } from "./schema-selection-qa";
import { KEYWORD_INDEX_SCHEMA } from "./schema-index";
import { SELECTION_QA_RUNTIME_SCHEMA } from "./schema-selection-qa-runtime";
import { KEYWORD_INDEX_FILES_SCHEMA } from "./schema-index-files";
import { SELECTION_QA_REPAIR_BUDGET_SCHEMA } from "./schema-selection-qa-repair-budget";
import { AUTH_SESSIONS_SCHEMA } from "./schema-auth-sessions";
import { SELECTION_QA_HISTORY_SCHEMA } from "./schema-selection-qa-history";
import { SELECTION_QA_AUTONOMY_SCHEMA } from "./schema-selection-qa-autonomy";
import { initializeSchema } from "./schema-migrations";
import { seedUpgradeFixture, snapshotLegacy } from "./schema-upgrade.fixture";

const history = [BASELINE_SCHEMA, SELECTION_QA_SCHEMA, KEYWORD_INDEX_SCHEMA,
  SELECTION_QA_RUNTIME_SCHEMA, KEYWORD_INDEX_FILES_SCHEMA, SELECTION_QA_REPAIR_BUDGET_SCHEMA,
  AUTH_SESSIONS_SCHEMA, SELECTION_QA_HISTORY_SCHEMA];

function oldDatabase(db: DatabaseSync): void {
  db.exec("PRAGMA foreign_keys=ON");
  db.exec(history.join("\n"));
  seedUpgradeFixture(db);
  db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL,applied_at INTEGER NOT NULL)");
  history.forEach((sql, i) => db.prepare("INSERT INTO schema_migrations VALUES(?,?,?)")
    .run(i + 1, createHash("sha256").update(sql).digest("hex"), 1));
  db.exec(`
    INSERT INTO selection_qa_conversations(id,user_id,book_id,selection_json,status,first_question,created_at,updated_at)
      VALUES('qa',1,1,'{}','active','原问题',1,1),('waiting',1,1,'{}','active','排队问题',1,1);
    INSERT INTO selection_qa_turns(id,user_id,conversation_id,turn_number,question,answer,status,deadline,last_sequence,created_at,updated_at,model_call_count,protocol_repair_call_count,model_snapshot_json,budget_json,phase)
      VALUES('done',1,'qa',1,'旧问题','原始完整回答','completed',9999999999999,1,1,2,4,2,'{"version":1,"policyVersion":"old"}','{"version":"old"}','terminal'),
        ('running',1,'qa',2,'重试问题','部分正文','running',9999999999999,1,2,3,2,1,'{"version":1,"policyVersion":"old"}','{"version":"old"}','planning'),
        ('queued',1,'waiting',1,'排队问题','','queued',9999999999999,1,2,3,0,0,'{"version":1,"policyVersion":"old"}','{"version":"old"}','queued');
    UPDATE selection_qa_turns SET retry_of_turn_id='done',lease_generation=3,lease_token='token',lease_owner='owner',lease_expires_at=9999999999999 WHERE id='running';
    INSERT INTO selection_qa_events VALUES('done',1,1,'terminal','{"status":"completed","answer":"原始完整回答"}',2),
      ('running',1,1,'answer_delta','{"text":"部分正文"}',3),('queued',1,1,'status','{"status":"queued"}',3);
    INSERT INTO selection_qa_evidence VALUES('done',1,'e-old','book','{"quote":"旧证据"}'),('running',1,'e-running','book','{"quote":"新证据"}');
    INSERT INTO selection_qa_commands VALUES(1,'qa-command','digest','{"turnId":"done"}',1);
    INSERT INTO annotation_selection_commands VALUES(1,'note-command','digest','{"annotationId":"annotation","revision":1}',1);
  `);
}

function selectionData(db: DatabaseSync) {
  return Object.fromEntries(["selection_qa_conversations", "selection_qa_turns", "selection_qa_events",
    "selection_qa_evidence", "selection_qa_commands", "annotation_selection_commands"].map(table =>
    [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}

describe("selection QA autonomous budget migration", () => {
  it("upgrades an isolated v9 backup to v10 atomically without changing the source or losing data", () => {
    const dir = mkdtempSync(join(tmpdir(), "rew-qa-v10-"));
    const original = new DatabaseSync(":memory:");
    let copy: DatabaseSync | undefined;
    try {
      oldDatabase(original);
      original.exec(SELECTION_QA_AUTONOMY_SCHEMA);
      original.prepare("INSERT INTO schema_migrations VALUES(9,?,1)").run(createHash("sha256").update(SELECTION_QA_AUTONOMY_SCHEMA).digest("hex"));
      original.exec("UPDATE selection_qa_turns SET status='running',error_code=NULL,lease_token='new-token',lease_owner='worker',lease_expires_at=9999999999999 WHERE id='running'");
      const path = join(dir, "backup.sqlite");
      original.prepare("VACUUM INTO ?").run(path);
      copy = new DatabaseSync(path); copy.exec("PRAGMA foreign_keys=ON");
      const before = selectionData(copy), legacy = snapshotLegacy(copy);
      const ledger = copy.prepare("SELECT * FROM schema_migrations ORDER BY version").all();
      expect(() => initializeSchema(copy!, v => { if (v === 10) throw new Error("injected-v10-failure"); })).toThrow("injected-v10-failure");
      expect(selectionData(copy)).toEqual(before);
      expect(copy.prepare("SELECT * FROM schema_migrations ORDER BY version").all()).toEqual(ledger);
      copy.close(); copy = new DatabaseSync(path); copy.exec("PRAGMA foreign_keys=ON");
      initializeSchema(copy); initializeSchema(copy);
      expect(snapshotLegacy(copy)).toEqual(legacy);
      for (const table of ["selection_qa_conversations", "selection_qa_evidence", "selection_qa_commands", "annotation_selection_commands"])
        expect(selectionData(copy)[table]).toEqual(before[table]);
      expect(copy.prepare("SELECT answer,status,model_call_count,tool_call_count,read_char_count,retry_of_turn_id FROM selection_qa_turns WHERE id='done'").get())
        .toEqual(original.prepare("SELECT answer,status,model_call_count,tool_call_count,read_char_count,retry_of_turn_id FROM selection_qa_turns WHERE id='done'").get());
      expect(copy.prepare("SELECT answer,status,error_code,lease_token,last_sequence FROM selection_qa_turns WHERE id='running'").get())
        .toEqual({ answer: "部分正文", status: "failed", error_code: "WORKER_UPGRADED", lease_token: null, last_sequence: 3 });
      expect(copy.prepare("SELECT * FROM schema_migrations WHERE version<=9 ORDER BY version").all()).toEqual(ledger);
      expect(copy.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(copy.prepare("PRAGMA integrity_check").get()!.integrity_check).toBe("ok");
      expect(selectionData(original)).toEqual(before);
      expect(original.prepare("SELECT max(version) v FROM schema_migrations").get()!.v).toBe(9);
    } finally { copy?.close(); original.close(); rmSync(dir, { recursive: true, force: true }); }
  });
  it("upgrades a v8 consistent backup, preserves related data, and rolls back a failed v9 attempt", () => {
    const dir = mkdtempSync(join(tmpdir(), "rew-qa-v9-"));
    const original = new DatabaseSync(":memory:");
    let copy: DatabaseSync | undefined;
    try {
      oldDatabase(original);
      const path = join(dir, "backup.sqlite");
      original.prepare("VACUUM INTO ?").run(path);
      copy = new DatabaseSync(path);
      copy.exec("PRAGMA foreign_keys=ON");
      const before = selectionData(copy), legacy = snapshotLegacy(copy);
      const originalLedger = copy.prepare("SELECT * FROM schema_migrations ORDER BY version").all();
      expect(() => initializeSchema(copy!, v => { if (v === 9) throw new Error("injected-v9-failure"); })).toThrow("injected-v9-failure");
      expect(selectionData(copy)).toEqual(before);
      expect(copy.prepare("SELECT * FROM schema_migrations ORDER BY version").all()).toEqual(originalLedger);
      copy.close(); copy = new DatabaseSync(path); copy.exec("PRAGMA foreign_keys=ON");
      initializeSchema(copy); initializeSchema(copy);
      expect(snapshotLegacy(copy)).toEqual(legacy);
      expect(copy.prepare("SELECT * FROM schema_migrations WHERE version<=8 ORDER BY version").all()).toEqual(originalLedger);
      for (const table of ["selection_qa_conversations", "selection_qa_evidence", "selection_qa_commands", "annotation_selection_commands"])
        expect(selectionData(copy)[table]).toEqual(before[table]);
      expect(copy.prepare("SELECT * FROM selection_qa_events WHERE sequence=1 ORDER BY rowid").all()).toEqual(before.selection_qa_events);
      expect(copy.prepare("SELECT model_call_count,answer,status,budget_json,model_snapshot_json FROM selection_qa_turns WHERE id='done'").get()).toEqual({
        model_call_count: 6, answer: "原始完整回答", status: "completed",
        budget_json: '{"version":"old"}', model_snapshot_json: '{"version":1,"policyVersion":"old"}',
      });
      expect(copy.prepare("SELECT model_call_count,retry_of_turn_id,answer,status,error_code,lease_generation,lease_token,lease_owner,lease_expires_at FROM selection_qa_turns WHERE id='running'").get()).toEqual({
        model_call_count: 3, retry_of_turn_id: "done", answer: "部分正文", status: "failed", error_code: "WORKER_UPGRADED",
        lease_generation: 4, lease_token: null, lease_owner: null, lease_expires_at: null,
      });
      expect(copy.prepare("SELECT status,error_code,last_sequence FROM selection_qa_turns WHERE id='queued'").get())
        .toEqual({ status: "failed", error_code: "WORKER_UPGRADED", last_sequence: 2 });
      expect(copy.prepare("SELECT payload_json FROM selection_qa_events WHERE turn_id='running' AND sequence=2").get()!.payload_json)
        .toBe('{"status":"failed","reason":"WORKER_UPGRADED","answer":"部分正文"}');
      expect(copy.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(copy.prepare("PRAGMA integrity_check").get()!.integrity_check).toBe("ok");
      expect(selectionData(original)).toEqual(before);
      expect(original.prepare("SELECT max(version) v FROM schema_migrations").get()!.v).toBe(8);
    } finally {
      copy?.close(); original.close(); rmSync(dir, { recursive: true, force: true });
    }
  });
  it("fresh DDL widens all finite resource counters and removes one-time delivery locking", () => {
    const db = new DatabaseSync(":memory:");
    try {
      initializeSchema(db); seedUpgradeFixture(db);
      db.exec("INSERT INTO selection_qa_conversations(id,user_id,book_id,selection_json,status,first_question,created_at,updated_at) VALUES('qa',1,1,'{}','active','问题',1,1)");
      db.exec("INSERT INTO selection_qa_turns(id,user_id,conversation_id,turn_number,question,status,deadline,created_at,updated_at) VALUES('turn',1,'qa',1,'问题','queued',1000,1,1)");
      expect(db.prepare("PRAGMA table_info(selection_qa_turns)").all().some(row => row.name === "protocol_repair_call_count")).toBe(false);
      expect(() => db.exec("UPDATE selection_qa_turns SET model_call_count=40,tool_call_count=60,read_char_count=500000")).not.toThrow();
      expect(() => db.exec("UPDATE selection_qa_turns SET model_call_count=41")).toThrow();
      expect(() => db.exec("UPDATE selection_qa_turns SET model_call_count=1.5")).toThrow();
      expect(() => db.exec("UPDATE selection_qa_turns SET tool_call_count=61")).toThrow();
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { db.close(); }
  });
});
