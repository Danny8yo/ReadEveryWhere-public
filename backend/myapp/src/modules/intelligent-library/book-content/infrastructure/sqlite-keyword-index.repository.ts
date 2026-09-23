import { PositionIndexFiles } from "./position-index-file";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  EpubIndexChunk,
  IndexBuildResult,
} from "@readeverywhere/epub-core/node";
import type { CurrentBookArtifactFencePort } from "../../public/current-book-artifact-fence.port";
import type {
  IndexGeneration,
  IndexIdentity,
  KeywordIndexRepository,
  RankedChunk,
} from "../application/ports/keyword-index.port";

type GenerationRow = {
  id: string;
  state: IndexGeneration["state"];
  error: string | null;
  unavailable_json: string;
};
export class SqliteKeywordIndexRepository implements KeywordIndexRepository {
  private readonly files: PositionIndexFiles;
  constructor(
    private readonly db: DatabaseSync,
    private readonly fence: CurrentBookArtifactFencePort,
    directory: string,
  ) { this.files = new PositionIndexFiles(directory); }
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw error;
    }
  }
  private generation(row: GenerationRow | undefined): IndexGeneration | null {
    return row
      ? {
          id: row.id,
          state: row.state,
          error: row.error,
          unavailable: JSON.parse(row.unavailable_json),
        }
      : null;
  }
  recoverInterrupted() {
    this.db
      .prepare(
        "UPDATE content_index_generations SET state='failed',error='INDEX_INTERRUPTED: previous process stopped before publication',updated_at=? WHERE state IN ('queued','building')",
      )
      .run(Date.now());
  }
  current(i: IndexIdentity) {
    return this.generation(
      this.db
        .prepare(
          `SELECT g.* FROM content_index_current c JOIN content_index_generations g ON g.id=c.generation_id WHERE c.identity_key=? AND g.user_id=? AND g.book_id=? AND g.state='ready'`,
        )
        .get(i.key, i.userId, i.bookId) as GenerationRow | undefined,
    );
  }
  latest(i: IndexIdentity) {
    return this.generation(
      this.db
        .prepare(
          "SELECT * FROM content_index_generations WHERE identity_key=? AND user_id=? AND book_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1",
        )
        .get(i.key, i.userId, i.bookId) as GenerationRow | undefined,
    );
  }
  begin(i: IndexIdentity, owner: string, rebuild = false) {
    return this.transaction(() => {
      const ready = this.current(i);
      if (ready && !rebuild) return { generation: ready, created: false };
      this.fence.assertCurrent(i.userId, i.artifact);
      const active = this.generation(
        this.db
          .prepare(
            "SELECT * FROM content_index_generations WHERE identity_key=? AND state IN ('queued','building')",
          )
          .get(i.key) as GenerationRow | undefined,
      );
      if (active) return { generation: active, created: false };
      const id = randomUUID(),
        now = Date.now();
      this.db
        .prepare(
          `INSERT INTO content_index_generations(id,identity_key,user_id,book_id,artifact_id,file_checksum,extractor_version,normalization_version,chunker_version,tokenizer_version,state,owner_token,created_at,updated_at)VALUES(?,?,?,?,?,?,?,?,?,?,'queued',?,?,?)`,
        )
        .run(
          id,
          i.key,
          i.userId,
          i.bookId,
          i.artifact.artifactId,
          i.contentRevision.fileChecksum,
          i.contentRevision.extractorVersion,
          i.contentRevision.normalizationVersion,
          i.version.chunkerVersion,
          i.version.tokenizerVersion,
          owner,
          now,
          now,
        );
      this.db.prepare("INSERT INTO content_index_files(generation_id,format) VALUES(?,'unigram-file-v1')").run(id);
      this.files.create(id,i.key);
      return {
        generation: {
          id,
          state: "queued" as const,
          error: null,
          unavailable: [],
        },
        created: true,
      };
    });
  }
  append(
    i: IndexIdentity,
    id: string,
    owner: string,
    chunks: EpubIndexChunk[],
  ) {
    if (!chunks.length || chunks.length > 16)
      throw new Error("Invalid index batch size");
    this.transaction(() => {
      this.fence.assertCurrent(i.userId, i.artifact);
      const row = this.db
        .prepare(
          "SELECT chunk_count FROM content_index_generations WHERE id=? AND identity_key=? AND owner_token=? AND state IN ('queued','building')",
        )
        .get(id, i.key, owner) as { chunk_count: number } | undefined;
      if (!row)
        throw new Error("INDEX_FENCED: generation no longer accepts chunks");
      const insert = this.db.prepare(
        "INSERT INTO content_index_position_chunks(generation_id,user_id,book_id,ordinal,section_index,href,start_offset,end_offset,quote,quote_hash,displayed_quote,cfi,tokens)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
      );
      const fileRows: {id:number;tokens:string}[] = [];
      chunks.forEach((c, n) => {
        if (c.ordinal !== row.chunk_count + n)
          throw new Error(
            "INDEX_CHUNK_SEQUENCE: incomplete or reordered batch",
          );
        const inserted = insert.run(
          id,
          i.userId,
          i.bookId,
          c.ordinal,
          c.sectionIndex,
          c.href,
          c.start,
          c.end,
          c.quote,
          c.quoteHash,
          c.displayedQuote,
          c.cfi,
          c.tokens,
        );
        fileRows.push({id:Number(inserted.lastInsertRowid),tokens:c.tokens});
      });
      this.files.append(id,fileRows);
      this.db
        .prepare(
          "UPDATE content_index_generations SET state='building',chunk_count=chunk_count+?,updated_at=? WHERE id=?",
        )
        .run(chunks.length, Date.now(), id);
    });
  }
  publish(
    i: IndexIdentity,
    id: string,
    owner: string,
    result: IndexBuildResult,
  ) {
    const validate = () => {
      this.fence.assertCurrent(i.userId, i.artifact);
      if (
        result.chunkerVersion !== i.version.chunkerVersion ||
        result.tokenizerVersion !== i.version.tokenizerVersion
      )
        throw new Error("INDEX_VERSION_MISMATCH");
      const row = this.db
        .prepare(
          "SELECT chunk_count FROM content_index_generations WHERE id=? AND identity_key=? AND owner_token=? AND state IN ('queued','building')",
        )
        .get(id, i.key, owner) as { chunk_count: number } | undefined;
      const actual = this.db
        .prepare(
          "SELECT count(*) AS n FROM content_index_position_chunks WHERE generation_id=?",
        )
        .get(id) as { n: number };
      if (
        !row ||
        row.chunk_count !== result.chunkCount ||
        actual.n !== result.chunkCount
      )
        throw new Error("INDEX_FENCED: incomplete generation cannot publish");
    };
    validate();
    const sealed=this.files.seal(id,i.key,result.chunkCount);
    this.transaction(() => {
      validate();
      this.db.prepare("UPDATE content_index_files SET sha256=?,byte_count=? WHERE generation_id=?").run(sealed.sha256,sealed.byteCount,id);
      this.db
        .prepare(
          "UPDATE content_index_generations SET state='ready',unavailable_json=?,updated_at=? WHERE id=?",
        )
        .run(JSON.stringify(result.unavailable), Date.now(), id);
      this.db
        .prepare(
          "INSERT INTO content_index_current(identity_key,generation_id)VALUES(?,?) ON CONFLICT(identity_key)DO UPDATE SET generation_id=excluded.generation_id",
        )
        .run(i.key, id);
    });
  }
  fail(id: string, owner: string, error: string) {
    this.db
      .prepare(
        "UPDATE content_index_generations SET state='failed',error=?,updated_at=? WHERE id=? AND owner_token=? AND state IN ('queued','building')",
      )
      .run(error, Date.now(), id, owner);
  }
  search(i: IndexIdentity, id: string, phrases: string[]): RankedChunk[] {
    if (!phrases.length) return [];
    const generation = this.db.prepare(`SELECT f.sha256,f.byte_count FROM content_index_generations g
      JOIN content_index_current p ON p.generation_id=g.id
      LEFT JOIN content_index_files f ON f.generation_id=g.id
      WHERE p.identity_key=? AND g.id=? AND g.state='ready' AND g.user_id=? AND g.book_id=?
      AND g.artifact_id=? AND g.file_checksum=? AND g.extractor_version=? AND g.normalization_version=?
      AND g.chunker_version=? AND g.tokenizer_version=?`).get(i.key,id,i.userId,i.bookId,i.artifact.artifactId,
      i.contentRevision.fileChecksum,i.contentRevision.extractorVersion,i.contentRevision.normalizationVersion,
      i.version.chunkerVersion,i.version.tokenizerVersion) as {sha256:string;byte_count:number}|undefined;
    if(!generation) return [];
    if(!generation.sha256 || !generation.byte_count) throw new Error("INDEX_CORRUPT: missing published file metadata");
    const ranked=this.files.search(id,i.key,generation.sha256,generation.byte_count,phrases.map(phrase=>({phrase,weight:1})));
    const get=this.db.prepare(`SELECT id,section_index AS sectionIndex,href,start_offset AS start,end_offset AS end,quote,quote_hash AS quoteHash,displayed_quote AS displayedQuote,cfi,tokens
      FROM content_index_position_chunks WHERE id=? AND generation_id=? AND user_id=? AND book_id=?`);
    return ranked.map(row=>{
      const chunk=get.get(row.id,id,i.userId,i.bookId) as unknown as Omit<RankedChunk,'score'>|undefined;
      if(!chunk) throw new Error("INDEX_CORRUPT: file references missing chunk");
      return {...chunk,score:row.score};
    });
  }
}
