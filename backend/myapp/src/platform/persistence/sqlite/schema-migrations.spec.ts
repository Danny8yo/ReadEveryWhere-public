import { SELECTION_QA_REPAIR_BUDGET_SCHEMA } from "./schema-selection-qa-repair-budget";
import { AUTH_SESSIONS_SCHEMA } from "./schema-auth-sessions";
import { SELECTION_QA_SCHEMA } from "./schema-selection-qa";
import { KEYWORD_INDEX_SCHEMA } from "./schema-index";
import { SELECTION_QA_RUNTIME_SCHEMA } from "./schema-selection-qa-runtime";
import { KEYWORD_INDEX_FILES_SCHEMA } from "./schema-index-files";
import { SELECTION_QA_HISTORY_SCHEMA } from "./schema-selection-qa-history";
import { SELECTION_QA_AUTONOMY_SCHEMA } from "./schema-selection-qa-autonomy";
import { SELECTION_QA_QUALITY_SCHEMA } from "./schema-selection-qa-quality";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedUpgradeFixture, snapshotLegacy } from "./schema-upgrade.fixture";
import { DatabaseSync } from "node:sqlite";
import { BASELINE_SCHEMA } from "./schema-baseline";
import { initializeSchema } from "./schema-migrations";

describe("versioned SQLite schema", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys=ON");
  });
  afterEach(() => db.close());
  it("migrates version 7 history metadata without changing saved questions or answers", () => {
    const history = [BASELINE_SCHEMA, SELECTION_QA_SCHEMA, KEYWORD_INDEX_SCHEMA, SELECTION_QA_RUNTIME_SCHEMA, KEYWORD_INDEX_FILES_SCHEMA, SELECTION_QA_REPAIR_BUDGET_SCHEMA, AUTH_SESSIONS_SCHEMA];
    db.exec(history.join("\n")); seedUpgradeFixture(db);
    db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL,applied_at INTEGER NOT NULL)");
    history.forEach((sql, index) => db.prepare("INSERT INTO schema_migrations VALUES(?,?,?)").run(index + 1, createHash("sha256").update(sql).digest("hex"), 1));
    db.prepare("INSERT INTO selection_qa_conversations(id,user_id,book_id,selection_json,status,first_question,created_at,updated_at,history_excerpt_json) VALUES('history',1,1,'{}','active','完整问题',1,1,?)").run('{"version":1,"items":[]}');
    db.exec("INSERT INTO selection_qa_turns(id,user_id,conversation_id,turn_number,question,answer,status,deadline,created_at,updated_at) VALUES('answer',1,'history',1,'完整问题','完整回答','completed',2,1,1)");
    const saved = db.prepare("SELECT question,answer FROM selection_qa_turns WHERE id='answer'").get();
    expect(() => initializeSchema(db, version => { if (version === 8) throw new Error("v8 failure"); })).toThrow("v8 failure");
    expect(db.prepare("SELECT max(version) v FROM schema_migrations").get()!.v).toBe(7);
    expect(db.prepare("PRAGMA table_info(selection_qa_conversations)").all().some(column => column.name === "history_excerpt_json")).toBe(true);
    expect(db.prepare("SELECT question,answer FROM selection_qa_turns WHERE id='answer'").get()).toEqual(saved);
    initializeSchema(db); initializeSchema(db);
    expect(db.prepare("SELECT max(version) v FROM schema_migrations").get()!.v).toBe(11);
    expect(db.prepare("PRAGMA table_info(selection_qa_conversations)").all().some(column => column.name === "history_excerpt_json")).toBe(false);
    expect(db.prepare("SELECT question,answer FROM selection_qa_turns WHERE id='answer'").get()).toEqual(saved);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it("upgrades a v6 backup without changing business data and atomically invalidates old credentials", () => {
    const history = [BASELINE_SCHEMA, SELECTION_QA_SCHEMA, KEYWORD_INDEX_SCHEMA, SELECTION_QA_RUNTIME_SCHEMA, KEYWORD_INDEX_FILES_SCHEMA, SELECTION_QA_REPAIR_BUDGET_SCHEMA];
    db.exec(history.join("\n")); seedUpgradeFixture(db);
    db.exec("INSERT INTO refresh_tokens(id,user_id,token_hash,expires_at,created_at) VALUES('old',1,'hash','2099-01-01','2026-01-01')");
    db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL,applied_at INTEGER NOT NULL)");
    history.forEach((sql,index) => db.prepare("INSERT INTO schema_migrations VALUES(?,?,?)").run(index+1,createHash("sha256").update(sql).digest("hex"),1));
    const dir = mkdtempSync(join(tmpdir(), "rew-session-upgrade-"));
    try {
      db.prepare("VACUUM INTO ?").run(join(dir,"backup.sqlite"));
      const copy = new DatabaseSync(join(dir,"backup.sqlite"));
      try {
        const before = snapshotLegacy(copy);
        expect(() => initializeSchema(copy, version => { if (version === 7) throw new Error("v7 failure"); })).toThrow("v7 failure");
        expect(copy.prepare("SELECT count(*) n FROM refresh_tokens").get()!.n).toBe(1);
        expect(copy.prepare("SELECT name FROM sqlite_schema WHERE name='auth_sessions'").get()).toBeUndefined();
        expect(snapshotLegacy(copy)).toEqual(before);
        initializeSchema(copy); initializeSchema(copy);
        expect(snapshotLegacy(copy)).toEqual(before);
        expect(copy.prepare("SELECT name FROM sqlite_schema WHERE name='refresh_tokens'").get()).toBeUndefined();
        expect(copy.prepare("SELECT count(*) n FROM auth_sessions").get()!.n).toBe(0);
        expect(copy.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally { copy.close(); }
      expect(db.prepare("SELECT count(*) n FROM refresh_tokens").get()!.n).toBe(1);
    } finally { rmSync(dir,{recursive:true,force:true}); }
  });
  it("rolls back migration 6 and preserves a version-5 database before a clean retry", () => {
    const history = [BASELINE_SCHEMA, SELECTION_QA_SCHEMA, KEYWORD_INDEX_SCHEMA, SELECTION_QA_RUNTIME_SCHEMA, KEYWORD_INDEX_FILES_SCHEMA];
    db.exec(history.join("\n"));
    seedUpgradeFixture(db);
    const before = snapshotLegacy(db);
    db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL,applied_at INTEGER NOT NULL)");
    history.forEach((sql, index) => db.prepare("INSERT INTO schema_migrations VALUES(?,?,?)").run(index + 1, createHash("sha256").update(sql).digest("hex"), 1));
    expect(() => initializeSchema(db, version => { if (version === 6) throw new Error("injected v6 failure"); })).toThrow("injected v6 failure");
    expect(db.prepare("SELECT max(version) v FROM schema_migrations").get()!.v).toBe(5);
    expect(db.prepare("PRAGMA table_info(selection_qa_turns)").all().some(column => column.name === "protocol_repair_call_count")).toBe(false);
    expect(snapshotLegacy(db)).toEqual(before);
    initializeSchema(db);
    initializeSchema(db);
    expect(db.prepare("SELECT max(version) v FROM schema_migrations").get()!.v).toBe(11);
    expect(db.prepare("PRAGMA table_info(selection_qa_turns)").all()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "model_call_count", notnull: 1, dflt_value: "0" })]),
    );
    expect(snapshotLegacy(db)).toEqual(before);
  });
  it("migrates a consistent version-4 backup, preserves user and old index rows, and rolls back migration 5", () => {
    const dir=mkdtempSync(join(tmpdir(),"rew-v4-upgrade-"));
    try {
      const history=[BASELINE_SCHEMA,SELECTION_QA_SCHEMA,KEYWORD_INDEX_SCHEMA,SELECTION_QA_RUNTIME_SCHEMA];
      db.exec(history.join("\n")); seedUpgradeFixture(db);
      db.exec("INSERT INTO reading_progress(user_id,book_id,location,device_id,device_sequence,revision,created_at,updated_at,fraction) VALUES(1,1,'epubcfi(/6/2)','reader-device',3,3,1,2,0.42)");
      db.exec("INSERT INTO reading_progress_devices(user_id,book_id,device_id,last_sequence,updated_at) VALUES(1,1,'reader-device',3,2)");
      db.exec("INSERT INTO bookmarks(user_id,book_id,location,created_at) VALUES(1,1,'epubcfi(/6/4)',1)");
      db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL,applied_at INTEGER NOT NULL)");
      history.forEach((sql,i)=>db.prepare("INSERT INTO schema_migrations VALUES(?,?,?)").run(i+1,createHash("sha256").update(sql).digest("hex"),1));
      db.exec("INSERT INTO content_index_generations(id,identity_key,user_id,book_id,artifact_id,file_checksum,extractor_version,normalization_version,chunker_version,tokenizer_version,state,owner_token,chunk_count,created_at,updated_at) VALUES('old','old',1,1,'artifact','checksum','extractor','normal','chunk','old-tokenizer','ready','owner',1,1,1)");
      db.exec("INSERT INTO content_index_chunks(generation_id,user_id,book_id,ordinal,section_index,href,start_offset,end_offset,quote,quote_hash,displayed_quote,cfi,tokens) VALUES('old',1,1,0,0,'a',0,1,'keep','hash','keep','cfi','t123')");
      db.exec("INSERT INTO content_index_current VALUES('old','old')");
      db.prepare("VACUUM INTO ?").run(join(dir,"backup.sqlite"));
      const copy=new DatabaseSync(join(dir,"backup.sqlite"));
      try {
        const users=snapshotLegacy(copy),old=copy.prepare("SELECT * FROM content_index_chunks").all();
        expect(()=>initializeSchema(copy,v=>{if(v===5) throw new Error("injected v5 failure");})).toThrow("injected v5 failure");
        expect(copy.prepare("SELECT max(version) v FROM schema_migrations").get()!.v).toBe(4);
        expect(copy.prepare("SELECT name FROM sqlite_schema WHERE name='content_index_files'").get()).toBeUndefined();
        initializeSchema(copy);initializeSchema(copy);
        expect(snapshotLegacy(copy)).toEqual(users);
        expect(copy.prepare("SELECT * FROM content_index_chunks").all()).toEqual(old);
        expect(copy.prepare("SELECT rowid FROM content_index_fts WHERE content_index_fts MATCH 't123'").all()).toHaveLength(1);
        expect(copy.prepare("SELECT generation_id FROM content_index_current WHERE identity_key='old'").get()!.generation_id).toBe("old");
        expect(copy.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally {copy.close();}
      expect(db.prepare("SELECT max(version) v FROM schema_migrations").get()!.v).toBe(4);
    } finally {rmSync(dir,{recursive:true,force:true});}
  });
  it("creates a complete fresh schema and repeats without mutation", () => {
    initializeSchema(db);
    initializeSchema(db);
    expect(
      db.prepare("SELECT COUNT(*) n FROM schema_migrations").get()!.n,
    ).toBe(11);
    expect(db.prepare("PRAGMA table_info(selection_qa_turns)").all()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "model_call_count", notnull: 1, dflt_value: "0" })]),
    );
  });
  it("preserves legacy users and schema_version=1 tasks during upgrade", () => {
    db.exec(BASELINE_SCHEMA);
    seedUpgradeFixture(db);
    const before = snapshotLegacy(db);
    initializeSchema(db);
    initializeSchema(db);
    expect(snapshotLegacy(db)).toEqual(before);
    expect(
      db.prepare("SELECT schema_version FROM ai_reading_tasks").get()!
        .schema_version,
    ).toBe(1);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it("rolls back failed migration and permits a clean retry", () => {
    db.exec(BASELINE_SCHEMA);
    expect(() =>
      initializeSchema(db, () => {
        throw new Error("injected failure");
      }),
    ).toThrow("injected failure");
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_schema WHERE name='schema_migrations'",
        )
        .get(),
    ).toBeUndefined();
    initializeSchema(db);
  });
  const sourceChecksumExtension = `
    ALTER TABLE book_artifacts ADD COLUMN source_checksum TEXT;
    CREATE UNIQUE INDEX uq_book_artifacts_active_source_checksum
        ON book_artifacts(user_id, source_checksum)
        WHERE status = 'active' AND source_checksum IS NOT NULL;
  `;
  it("preserves the historical source checksum extension through rollback and repeated upgrade", () => {
    db.exec(BASELINE_SCHEMA + sourceChecksumExtension);
    seedUpgradeFixture(db);
    db.exec("UPDATE book_artifacts SET source_checksum='original-source-hash'");
    const before = snapshotLegacy(db);
    const index = db.prepare("SELECT sql FROM sqlite_schema WHERE name='uq_book_artifacts_active_source_checksum'").get();
    expect(() => initializeSchema(db, () => { throw new Error("injected failure"); })).toThrow("injected failure");
    expect(snapshotLegacy(db)).toEqual(before);
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='schema_migrations'").get()).toBeUndefined();
    initializeSchema(db);
    initializeSchema(db);
    expect(snapshotLegacy(db)).toEqual(before);
    expect(db.prepare("SELECT sql FROM sqlite_schema WHERE name='uq_book_artifacts_active_source_checksum'").get()).toEqual(index);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it.each([
    sourceChecksumExtension.replace("CREATE UNIQUE INDEX", "CREATE INDEX"),
    sourceChecksumExtension.replace("source_checksum TEXT", "source_checksum INTEGER"),
    sourceChecksumExtension.replace("status = 'active'", "status = 'staging'"),
  ])("rejects modified historical extension constraints", (extension) => {
    db.exec(BASELINE_SCHEMA + extension);
    expect(() => initializeSchema(db)).toThrow("Unsupported SQLite schema");
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='schema_migrations'").get()).toBeUndefined();
  });
  it("rejects unknown unversioned schema without applying DDL", () => {
    db.exec(
      "CREATE TABLE precious(value TEXT); INSERT INTO precious VALUES('keep')",
    );
    expect(() => initializeSchema(db)).toThrow("Unsupported SQLite schema");
    expect(db.prepare("SELECT value FROM precious").get()!.value).toBe("keep");
  });
  it("upgrades an isolated consistent backup and survives rollback/reopen", () => {
    const dir = mkdtempSync(join(tmpdir(), "selection-upgrade-"));
    const original = new DatabaseSync(join(dir, "original.sqlite"));
    try {
      original.exec(BASELINE_SCHEMA);
      seedUpgradeFixture(original);
      const before = snapshotLegacy(original);
      const path = join(dir, "backup.sqlite");
      original.prepare("VACUUM INTO ?").run(path);
      let copy = new DatabaseSync(path);
      copy.exec("PRAGMA foreign_keys=ON");
      expect(() =>
        initializeSchema(copy, () => {
          throw new Error("fail");
        }),
      ).toThrow("fail");
      copy.close();
      copy = new DatabaseSync(path);
      expect(snapshotLegacy(copy)).toEqual(before);
      initializeSchema(copy);
      expect(snapshotLegacy(copy)).toEqual(before);
      copy.close();
      expect(snapshotLegacy(original)).toEqual(before);
    } finally {
      original.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("rejects a schema whose CHECK constraint has been removed", () => {
    db.exec(
      BASELINE_SCHEMA.replace(
        "CHECK (confidence_kind IS NULL OR confidence_kind IN ('ai-score', 'user-determined')),",
        "",
      ),
    );
    expect(() => initializeSchema(db)).toThrow("Unsupported SQLite schema");
  });

  it("F2 migration 11 keeps every published unigram file record and its chunks, then admits dual files", () => {
    const history = [BASELINE_SCHEMA, SELECTION_QA_SCHEMA, KEYWORD_INDEX_SCHEMA, SELECTION_QA_RUNTIME_SCHEMA, KEYWORD_INDEX_FILES_SCHEMA, SELECTION_QA_REPAIR_BUDGET_SCHEMA, AUTH_SESSIONS_SCHEMA, SELECTION_QA_HISTORY_SCHEMA, SELECTION_QA_AUTONOMY_SCHEMA, SELECTION_QA_QUALITY_SCHEMA];
    db.exec(history.join("\n")); seedUpgradeFixture(db);
    db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL,applied_at INTEGER NOT NULL)");
    history.forEach((sql, index) => db.prepare("INSERT INTO schema_migrations VALUES(?,?,?)").run(index + 1, createHash("sha256").update(sql).digest("hex"), 1));
    const artifact = db.prepare("SELECT artifact_id,user_id,book_id,checksum FROM book_artifacts LIMIT 1").get() as { artifact_id: string; user_id: number; book_id: number; checksum: string };
    db.prepare(`INSERT INTO content_index_generations(id,identity_key,user_id,book_id,artifact_id,file_checksum,extractor_version,normalization_version,chunker_version,tokenizer_version,state,owner_token,chunk_count,created_at,updated_at)
      VALUES('11111111-1111-1111-1111-111111111111','key',?,?,?,?,'e','n','c','t','ready','o',1,1,1)`).run(artifact.user_id, artifact.book_id, artifact.artifact_id, artifact.checksum);
    db.prepare("INSERT INTO content_index_files(generation_id,format,sha256,byte_count) VALUES(?,'unigram-file-v1',?,10)").run("11111111-1111-1111-1111-111111111111", "a".repeat(64));
    db.prepare(`INSERT INTO content_index_position_chunks(generation_id,user_id,book_id,ordinal,section_index,href,start_offset,end_offset,quote,quote_hash,displayed_quote,cfi,tokens)
      VALUES('11111111-1111-1111-1111-111111111111',?,?,0,0,'c.xhtml',0,2,'证据','h','证据','epubcfi(/6/2!/4)','t1')`).run(artifact.user_id, artifact.book_id);
    const before = { files: db.prepare("SELECT * FROM content_index_files").all(), chunks: db.prepare("SELECT * FROM content_index_position_chunks").all() };
    initializeSchema(db);
    expect(db.prepare("SELECT max(version) v FROM schema_migrations").get()!.v).toBe(11);
    expect(db.prepare("SELECT generation_id,format,sha256,byte_count FROM content_index_files").all()).toEqual(before.files.map(({ generation_id, format, sha256, byte_count }: any) => ({ generation_id, sha256, byte_count, format })));
    expect(db.prepare("SELECT * FROM content_index_position_chunks").all()).toEqual(before.chunks);
    db.prepare("UPDATE content_index_files SET format='dual-file-v1'").run();
    expect(() => db.prepare("UPDATE content_index_files SET format='other'").run()).toThrow();
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it("upgrades a valid historical ledger prefix", () => {
    db.exec(BASELINE_SCHEMA);
    db.exec(
      "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL,applied_at INTEGER NOT NULL)",
    );
    db.prepare("INSERT INTO schema_migrations VALUES(1,?,1)").run(
      createHash("sha256").update(BASELINE_SCHEMA).digest("hex"),
    );
    initializeSchema(db);
    expect(
      db.prepare("SELECT COUNT(*) n FROM schema_migrations").get()!.n,
    ).toBe(11);
  });
  it("rejects changed checksum, a future version, and a noncontiguous ledger", () => {
    initializeSchema(db);
    db.exec("UPDATE schema_migrations SET checksum='modified' WHERE version=2");
    expect(() => initializeSchema(db)).toThrow(
      "Unsupported or modified SQLite migration ledger",
    );
    db.exec("DELETE FROM schema_migrations WHERE version=2");
    db.exec("INSERT INTO schema_migrations VALUES(999,'future',1)");
    expect(() => initializeSchema(db)).toThrow(
      "Unsupported or modified SQLite migration ledger",
    );
  });
});
