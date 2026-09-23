/** Immutable migration 3. Index rows are derived; user-authored state is untouched. */
export const KEYWORD_INDEX_SCHEMA = `
CREATE TABLE content_index_generations (
  id TEXT PRIMARY KEY, identity_key TEXT NOT NULL, user_id INTEGER NOT NULL, book_id INTEGER NOT NULL,
  artifact_id TEXT NOT NULL, file_checksum TEXT NOT NULL, extractor_version TEXT NOT NULL,
  normalization_version TEXT NOT NULL, chunker_version TEXT NOT NULL, tokenizer_version TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('queued','building','ready','failed')),
  owner_token TEXT NOT NULL, chunk_count INTEGER NOT NULL DEFAULT 0 CHECK(chunk_count>=0),
  error TEXT, unavailable_json TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE(id,user_id,book_id), FOREIGN KEY(book_id,user_id) REFERENCES books(id,user_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX content_index_one_active ON content_index_generations(identity_key) WHERE state IN ('queued','building');
CREATE INDEX content_index_identity ON content_index_generations(identity_key,created_at);
CREATE TABLE content_index_current (
  identity_key TEXT PRIMARY KEY, generation_id TEXT NOT NULL UNIQUE,
  FOREIGN KEY(generation_id) REFERENCES content_index_generations(id) ON DELETE CASCADE
);
CREATE TABLE content_index_chunks (
  id INTEGER PRIMARY KEY, generation_id TEXT NOT NULL, user_id INTEGER NOT NULL, book_id INTEGER NOT NULL,
  ordinal INTEGER NOT NULL, section_index INTEGER NOT NULL CHECK(section_index>=0), href TEXT NOT NULL,
  start_offset INTEGER NOT NULL CHECK(start_offset>=0), end_offset INTEGER NOT NULL CHECK(end_offset>start_offset),
  quote TEXT NOT NULL, quote_hash TEXT NOT NULL, displayed_quote TEXT NOT NULL, cfi TEXT NOT NULL, tokens TEXT NOT NULL,
  UNIQUE(generation_id,ordinal),
  FOREIGN KEY(generation_id,user_id,book_id) REFERENCES content_index_generations(id,user_id,book_id) ON DELETE CASCADE
);
CREATE VIRTUAL TABLE content_index_fts USING fts5(tokens,content='content_index_chunks',content_rowid='id',tokenize='unicode61');
CREATE TRIGGER content_index_chunks_insert AFTER INSERT ON content_index_chunks BEGIN
 INSERT INTO content_index_fts(rowid,tokens) VALUES(new.id,new.tokens);
END;
CREATE TRIGGER content_index_chunks_delete AFTER DELETE ON content_index_chunks BEGIN
 INSERT INTO content_index_fts(content_index_fts,rowid,tokens) VALUES('delete',old.id,old.tokens);
END;
CREATE TRIGGER content_index_chunks_update AFTER UPDATE ON content_index_chunks BEGIN
 INSERT INTO content_index_fts(content_index_fts,rowid,tokens) VALUES('delete',old.id,old.tokens);
 INSERT INTO content_index_fts(rowid,tokens) VALUES(new.id,new.tokens);
END;
`;
