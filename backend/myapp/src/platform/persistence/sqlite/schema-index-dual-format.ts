/**
 * Migration 11. Allows dual-file-v1 generation files. The FK parent table is widened in place
 * (add/copy/drop/rename) instead of rebuilt, so ON DELETE CASCADE never touches existing chunks.
 */
export const KEYWORD_INDEX_DUAL_FORMAT_SCHEMA = `
ALTER TABLE content_index_files ADD COLUMN p11_format TEXT NOT NULL DEFAULT 'unigram-file-v1' CHECK(p11_format IN ('unigram-file-v1','dual-file-v1'));
UPDATE content_index_files SET p11_format=format;
ALTER TABLE content_index_files DROP COLUMN format;
ALTER TABLE content_index_files RENAME COLUMN p11_format TO format;
`;
