import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync, openSync, closeSync, fsyncSync, readFileSync, renameSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { DUAL_MAX_LIST_TERMS, type DualRecallList } from "@readeverywhere/epub-core/keywords";

export type IndexFileFormat = "unigram-file-v1" | "dual-file-v1";
export interface PhraseClause { phrase: string; weight: number }
export interface IndexFileRow { id: number; tokens: string; bigramTokens?: string; wordTokens?: string }
/** Each dual table holds one stream; the prefix guards against mixing streams in one MATCH. */
const TABLES = {
  fts: { prefix: "t", maxClauses: 16 },
  fts_char: { prefix: "t", maxClauses: 16 },
  fts_bigram: { prefix: "b", maxClauses: DUAL_MAX_LIST_TERMS },
  fts_word: { prefix: "w", maxClauses: DUAL_MAX_LIST_TERMS },
} as const;
type FtsTable = keyof typeof TABLES;
function searchTable(db: DatabaseSync, table: FtsTable, clauses: PhraseClause[], minimum: number, limit: number) {
  const { prefix, maxClauses } = TABLES[table];
  const shape = new RegExp(`^${prefix}[0-9a-f]+(?: ${prefix}[0-9a-f]+)*$`);
  if (!clauses.length || clauses.length > maxClauses || !Number.isInteger(minimum) || minimum < 1 || minimum > clauses.length ||
      !Number.isInteger(limit) || limit < 1 || limit > 50 ||
      clauses.some(c => !shape.test(c.phrase) || c.phrase.length > 8192 || !Number.isFinite(c.weight) || c.weight <= 0 || c.weight > 16))
    throw new Error("QUERY_INVALID: invalid weighted phrase plan");
  if (new Set(clauses.map(c=>c.phrase)).size !== clauses.length) throw new Error("QUERY_INVALID: duplicate phrase");
  // MATERIALIZED evaluates bm25 inside its MATCH context before aggregation.
  // No per-clause truncation: a balanced multi-clause match must not be lost.
  const arms = clauses.map(() => `SELECT rowid AS id,bm25(${table})*? AS score FROM ${table} WHERE ${table} MATCH ?`);
  const params = clauses.flatMap(c => [c.weight, `"${c.phrase}"`]);
  return db.prepare(`WITH hits AS MATERIALIZED (${arms.join(" UNION ALL ")}) SELECT id,sum(score) AS score FROM hits GROUP BY id HAVING count(*)>=? ORDER BY score,id LIMIT ${limit}`).all(...params,minimum) as {id:number;score:number}[];
}
export function searchPhrases(db: DatabaseSync, clauses: PhraseClause[], minimum = 1) {
  return searchTable(db, "fts", clauses, minimum, 20);
}
/**
 * One dual recall list. Over-long single-token bags keep their rarest terms by this book's
 * document frequency (absent terms last) so the cap is deterministic and lexical, never semantic.
 */
export function searchRecallList(db: DatabaseSync, list: DualRecallList, limit: number) {
  const table: FtsTable = list.table === "char" ? "fts_char" : list.table === "bigram" ? "fts_bigram" : "fts_word";
  let phrases = list.phrases;
  const bag = list.kind === "word_query" || list.kind === "word_need" || list.kind === "bigram_soft";
  if (bag && phrases.length > DUAL_MAX_LIST_TERMS) {
    const vocab = list.table === "word" ? "vocab_word" : "vocab_bigram";
    const placeholders = phrases.map(() => "?").join(",");
    const df = new Map((db.prepare(`SELECT term,doc FROM ${vocab} WHERE term IN (${placeholders})`).all(...phrases) as {term:string;doc:number}[])
      .map(row => [row.term, row.doc]));
    phrases = [...phrases].sort((a, b) => {
      const da = df.get(a), dbb = df.get(b);
      if (da === undefined || dbb === undefined) return da === dbb ? a.localeCompare(b) : da === undefined ? 1 : -1;
      return da - dbb || a.localeCompare(b);
    }).slice(0, DUAL_MAX_LIST_TERMS);
  }
  const minimum = list.minimum === 1 ? 1 : Math.min(phrases.length, Math.max(list.minimum.floor, Math.ceil(list.minimum.ratio * phrases.length)));
  return { considered: phrases.length, minimum, hits: searchTable(db, table, phrases.map(phrase => ({ phrase, weight: 1 })), minimum, limit) };
}

/** A closed, immutable file per generation. No file is served before central publication. */
export class PositionIndexFiles {
  private readonly root: string;
  constructor(root: string) { this.root = resolve(root); }
  path(id: string, ready = false) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid index generation path");
    return join(this.root, id + (ready ? ".sqlite" : ".building.sqlite"));
  }
  private sync(path: string) {
    const fd=openSync(path,"r");
    try { fsyncSync(fd); } finally { closeSync(fd); }
  }
  private tables(format: IndexFileFormat): FtsTable[] {
    return format === "dual-file-v1" ? ["fts_char", "fts_bigram", "fts_word"] : ["fts"];
  }
  private identity(db: DatabaseSync): { key: string | undefined; format: IndexFileFormat | string } {
    const columns=(db.prepare("PRAGMA table_info(identity)").all() as {name:string}[]).map(c=>c.name);
    if (columns.join()==="key") return { key: (db.prepare("SELECT key FROM identity").get() as {key:string}|undefined)?.key, format: "unigram-file-v1" };
    if (columns.join()!=="key,format") throw new Error("INDEX_CORRUPT: unknown identity layout");
    const row=db.prepare("SELECT key,format FROM identity").get() as {key:string;format:string}|undefined;
    return { key: row?.key, format: row?.format ?? "" };
  }
  create(id: string, key: string, format: IndexFileFormat) {
    mkdirSync(this.root,{recursive:true,mode:0o700});
    const path=this.path(id);
    const fd=openSync(path,"wx",0o600); closeSync(fd);
    const db=new DatabaseSync(path);
    try {
      const fts = format === "dual-file-v1"
        ? "CREATE VIRTUAL TABLE fts_char USING fts5(tokens,tokenize='unicode61'); CREATE VIRTUAL TABLE fts_bigram USING fts5(tokens,tokenize='unicode61'); CREATE VIRTUAL TABLE fts_word USING fts5(tokens,tokenize='unicode61'); CREATE VIRTUAL TABLE vocab_bigram USING fts5vocab(fts_bigram,'row'); CREATE VIRTUAL TABLE vocab_word USING fts5vocab(fts_word,'row');"
        : "CREATE VIRTUAL TABLE fts USING fts5(tokens,tokenize='unicode61');";
      // unigram files keep the original single-column identity so already published files stay readable.
      if (format === "dual-file-v1") {
        db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; CREATE TABLE identity(key TEXT NOT NULL, format TEXT NOT NULL); ${fts}`);
        db.prepare("INSERT INTO identity VALUES(?,?)").run(key, format);
      } else {
        db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; CREATE TABLE identity(key TEXT NOT NULL); ${fts}`);
        db.prepare("INSERT INTO identity VALUES(?)").run(key);
      }
    } finally { db.close(); }
  }
  append(id: string, format: IndexFileFormat, rows: IndexFileRow[]) {
    const db=new DatabaseSync(this.path(id),{open:false});
    // Opening must not silently recreate a missing build file.
    if(!existsSync(this.path(id))) throw new Error("INDEX_FILE_MISSING: building file");
    db.open();
    try {
      db.exec("PRAGMA synchronous=FULL; PRAGMA cache_size=-8192; BEGIN IMMEDIATE");
      if (format === "dual-file-v1") {
        const char=db.prepare("INSERT INTO fts_char(rowid,tokens) VALUES(?,?)"),
          bigram=db.prepare("INSERT INTO fts_bigram(rowid,tokens) VALUES(?,?)"),
          word=db.prepare("INSERT INTO fts_word(rowid,tokens) VALUES(?,?)");
        for(const row of rows) {
          if (typeof row.bigramTokens !== "string" || typeof row.wordTokens !== "string")
            throw new Error("INDEX_STREAM_MISSING: dual index chunk lacks bigram or word stream");
          char.run(row.id,row.tokens); bigram.run(row.id,row.bigramTokens); word.run(row.id,row.wordTokens);
        }
      } else {
        const insert=db.prepare("INSERT INTO fts(rowid,tokens) VALUES(?,?)");
        for(const row of rows) insert.run(row.id,row.tokens);
      }
      db.exec("COMMIT");
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    } finally { db.close(); }
  }
  seal(id: string, key: string, format: IndexFileFormat, count: number) {
    const path=this.path(id);
    const db=new DatabaseSync(path,{readOnly:true});
    try {
      const identity=this.identity(db);
      if(identity.key!==key || identity.format!==format ||
         this.tables(format).some(table => db.prepare(`SELECT count(*) n FROM ${table}`).get()!.n!==count))
        throw new Error("INDEX_FENCED: incomplete positional file");
      if(db.prepare("PRAGMA integrity_check").get()!.integrity_check!=="ok") throw new Error("INDEX_CORRUPT: integrity check");
    } finally { db.close(); }
    this.sync(path);
    const data=readFileSync(path),sha256=createHash("sha256").update(data).digest("hex");
    if(existsSync(this.path(id,true))) throw new Error("INDEX_FENCED: file already sealed");
    renameSync(path,this.path(id,true)); this.sync(this.root);
    return {sha256,byteCount:data.length};
  }
  /** Verifies the sealed file before any query runs against it. */
  read<T>(id: string, key: string, format: IndexFileFormat, sha256: string, byteCount: number, query: (db: DatabaseSync) => T): T {
    const path=this.path(id,true),data=readFileSync(path);
    if(data.length!==byteCount || createHash("sha256").update(data).digest("hex")!==sha256)
      throw new Error("INDEX_CORRUPT: published file checksum mismatch");
    const db=new DatabaseSync(path,{readOnly:true});
    try {
      db.exec("PRAGMA query_only=ON; PRAGMA cache_size=-8192");
      const identity=this.identity(db);
      if(identity.key!==key) throw new Error("INDEX_CORRUPT: file identity mismatch");
      if(identity.format!==format) throw new Error("INDEX_CORRUPT: file format mismatch");
      const present=new Set((db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as {name:string}[]).map(r=>r.name));
      if(this.tables(format).some(table=>!present.has(table))) throw new Error("INDEX_CORRUPT: missing index table");
      return query(db);
    } finally { db.close(); }
  }
  search(id: string, key: string, sha256: string, byteCount: number, clauses: PhraseClause[], minimum=1) {
    return this.read(id, key, "unigram-file-v1", sha256, byteCount, db => searchPhrases(db, clauses, minimum));
  }
}
