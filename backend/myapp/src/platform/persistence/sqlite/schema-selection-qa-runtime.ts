/** Immutable migration 4: execution fencing; preserves all user questions and answers. */
export const SELECTION_QA_RUNTIME_SCHEMA = `
ALTER TABLE selection_qa_turns ADD COLUMN lease_owner TEXT;
ALTER TABLE selection_qa_turns ADD COLUMN lease_expires_at INTEGER;
ALTER TABLE selection_qa_turns ADD COLUMN phase TEXT NOT NULL DEFAULT 'queued';
ALTER TABLE selection_qa_turns ADD COLUMN model_call_count INTEGER NOT NULL DEFAULT 0 CHECK(model_call_count BETWEEN 0 AND 4);
ALTER TABLE selection_qa_turns ADD COLUMN tool_call_count INTEGER NOT NULL DEFAULT 0 CHECK(tool_call_count BETWEEN 0 AND 6);
ALTER TABLE selection_qa_turns ADD COLUMN read_char_count INTEGER NOT NULL DEFAULT 0 CHECK(read_char_count BETWEEN 0 AND 24000);
ALTER TABLE selection_qa_turns ADD COLUMN usage_json TEXT NOT NULL DEFAULT '{"promptTokens":0,"completionTokens":0,"totalTokens":0}' CHECK(json_valid(usage_json));
ALTER TABLE selection_qa_conversations ADD COLUMN history_excerpt_json TEXT CHECK(history_excerpt_json IS NULL OR json_valid(history_excerpt_json));
UPDATE selection_qa_turns SET phase='terminal' WHERE status IN ('completed','cancelled','failed','timed_out');
INSERT INTO selection_qa_events(turn_id,user_id,sequence,kind,payload_json,created_at)
 SELECT id,user_id,last_sequence+1,'terminal',json_object('status','failed','reason','EXECUTION_NOT_CONFIGURED','answer',answer),updated_at
 FROM selection_qa_turns WHERE status IN ('queued','running') AND model_snapshot_json IS NULL;
UPDATE selection_qa_turns SET status='failed',error_code='EXECUTION_NOT_CONFIGURED',phase='terminal',last_sequence=last_sequence+1,lease_generation=lease_generation+1
 WHERE status IN ('queued','running') AND model_snapshot_json IS NULL;
`;
