import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync, openSync, closeSync, fsyncSync, readFileSync, renameSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

export interface PhraseClause { phrase: string; weight: number }
export function searchPhrases(db: DatabaseSync, clauses: PhraseClause[], minimum = 1) {
  if (!clauses.length || clauses.length > 16 || !Number.isInteger(minimum) || minimum < 1 || minimum > clauses.length ||
      clauses.some(c => !/^t[0-9a-f]+(?: t[0-9a-f]+)*$/.test(c.phrase) || c.phrase.length > 8192 || !Number.isFinite(c.weight) || c.weight <= 0 || c.weight > 16))
    throw new Error("QUERY_INVALID: invalid weighted phrase plan");
  if (new Set(clauses.map(c=>c.phrase)).size !== clauses.length) throw new Error("QUERY_INVALID: duplicate phrase");
  // MATERIALIZED evaluates bm25 inside its MATCH context before aggregation.
  // No per-clause truncation: a balanced multi-clause match must not be lost.
  const arms = clauses.map(() => "SELECT rowid AS id,bm25(fts)*? AS score FROM fts WHERE fts MATCH ?");
  const params = clauses.flatMap(c => [c.weight, `"${c.phrase}"`]);
  return db.prepare(`WITH hits AS MATERIALIZED (${arms.join(" UNION ALL ")}) SELECT id,sum(score) AS score FROM hits GROUP BY id HAVING count(*)>=? ORDER BY score,id LIMIT 20`).all(...params,minimum) as {id:number;score:number}[];
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
  create(id: string, key: string) {
    mkdirSync(this.root,{recursive:true,mode:0o700});
    const path=this.path(id);
    const fd=openSync(path,"wx",0o600); closeSync(fd);
    const db=new DatabaseSync(path);
    try {
      db.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; CREATE TABLE identity(key TEXT NOT NULL); CREATE VIRTUAL TABLE fts USING fts5(tokens,tokenize='unicode61');");
      db.prepare("INSERT INTO identity VALUES(?)").run(key);
    } finally { db.close(); }
  }
  append(id: string, rows: {id:number;tokens:string}[]) {
    const db=new DatabaseSync(this.path(id),{open:false});
    // Opening must not silently recreate a missing build file.
    if(!existsSync(this.path(id))) throw new Error("INDEX_FILE_MISSING: building file");
    db.open();
    try {
      db.exec("PRAGMA synchronous=FULL; PRAGMA cache_size=-8192; BEGIN IMMEDIATE");
      const insert=db.prepare("INSERT INTO fts(rowid,tokens) VALUES(?,?)");
      for(const row of rows) insert.run(row.id,row.tokens);
      db.exec("COMMIT");
    } finally { db.close(); }
  }
  seal(id: string, key: string, count: number) {
    const path=this.path(id);
    const db=new DatabaseSync(path,{readOnly:true});
    try {
      if(db.prepare("SELECT key FROM identity").get()!.key!==key || db.prepare("SELECT count(*) n FROM fts").get()!.n!==count)
        throw new Error("INDEX_FENCED: incomplete positional file");
      if(db.prepare("PRAGMA integrity_check").get()!.integrity_check!=="ok") throw new Error("INDEX_CORRUPT: integrity check");
    } finally { db.close(); }
    this.sync(path);
    const data=readFileSync(path),sha256=createHash("sha256").update(data).digest("hex");
    if(existsSync(this.path(id,true))) throw new Error("INDEX_FENCED: file already sealed");
    renameSync(path,this.path(id,true)); this.sync(this.root);
    return {sha256,byteCount:data.length};
  }
  search(id: string, key: string, sha256: string, byteCount: number, clauses: PhraseClause[], minimum=1) {
    const path=this.path(id,true),data=readFileSync(path);
    if(data.length!==byteCount || createHash("sha256").update(data).digest("hex")!==sha256)
      throw new Error("INDEX_CORRUPT: published file checksum mismatch");
    const db=new DatabaseSync(path,{readOnly:true});
    try {
      db.exec("PRAGMA query_only=ON; PRAGMA cache_size=-8192");
      if(db.prepare("SELECT key FROM identity").get()!.key!==key) throw new Error("INDEX_CORRUPT: file identity mismatch");
      return searchPhrases(db,clauses,minimum);
    } finally { db.close(); }
  }
}
