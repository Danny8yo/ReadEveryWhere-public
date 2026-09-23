/** Migration 5. Old generations/chunks/FTS and all business state are preserved. */
export const KEYWORD_INDEX_FILES_SCHEMA = `
CREATE TABLE content_index_files (
 generation_id TEXT PRIMARY KEY REFERENCES content_index_generations(id) ON DELETE CASCADE,
 format TEXT NOT NULL CHECK(format='unigram-file-v1'),
 sha256 TEXT, byte_count INTEGER,
 CHECK((sha256 IS NULL AND byte_count IS NULL) OR (sha256 IS NOT NULL AND byte_count IS NOT NULL AND length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*' AND byte_count>0))
);
CREATE TABLE content_index_position_chunks (
 id INTEGER PRIMARY KEY, generation_id TEXT NOT NULL, user_id INTEGER NOT NULL, book_id INTEGER NOT NULL,
 ordinal INTEGER NOT NULL, section_index INTEGER NOT NULL CHECK(section_index>=0), href TEXT NOT NULL,
 start_offset INTEGER NOT NULL CHECK(start_offset>=0), end_offset INTEGER NOT NULL CHECK(end_offset>start_offset),
 quote TEXT NOT NULL, quote_hash TEXT NOT NULL, displayed_quote TEXT NOT NULL, cfi TEXT NOT NULL, tokens TEXT NOT NULL,
 UNIQUE(generation_id,ordinal),
 FOREIGN KEY(generation_id,user_id,book_id) REFERENCES content_index_generations(id,user_id,book_id) ON DELETE CASCADE,
 FOREIGN KEY(generation_id) REFERENCES content_index_files(generation_id) ON DELETE CASCADE
);
`;
