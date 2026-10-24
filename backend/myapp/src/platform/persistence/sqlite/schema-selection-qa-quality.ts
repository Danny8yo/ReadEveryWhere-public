/** Migration 10: widen finite counters without rebuilding the FK parent table. */
export const SELECTION_QA_QUALITY_SCHEMA = `
ALTER TABLE selection_qa_turns ADD COLUMN p1_model_count INTEGER NOT NULL DEFAULT 0 CHECK(typeof(p1_model_count)='integer' AND p1_model_count BETWEEN 0 AND 40);
ALTER TABLE selection_qa_turns ADD COLUMN p1_tool_count INTEGER NOT NULL DEFAULT 0 CHECK(typeof(p1_tool_count)='integer' AND p1_tool_count BETWEEN 0 AND 60);
ALTER TABLE selection_qa_turns ADD COLUMN p1_read_count INTEGER NOT NULL DEFAULT 0 CHECK(typeof(p1_read_count)='integer' AND p1_read_count BETWEEN 0 AND 500000);
UPDATE selection_qa_turns SET p1_model_count=model_call_count,p1_tool_count=tool_call_count,p1_read_count=read_char_count;
ALTER TABLE selection_qa_turns DROP COLUMN model_call_count;
ALTER TABLE selection_qa_turns DROP COLUMN tool_call_count;
ALTER TABLE selection_qa_turns DROP COLUMN read_char_count;
ALTER TABLE selection_qa_turns RENAME COLUMN p1_model_count TO model_call_count;
ALTER TABLE selection_qa_turns RENAME COLUMN p1_tool_count TO tool_call_count;
ALTER TABLE selection_qa_turns RENAME COLUMN p1_read_count TO read_char_count;
ALTER TABLE selection_qa_turns DROP COLUMN final_model_call_reserved;
INSERT INTO selection_qa_events(turn_id,user_id,sequence,kind,payload_json,created_at)
 SELECT id,user_id,last_sequence+1,'terminal',json_object('status','failed','reason','WORKER_UPGRADED','answer',answer),CAST(strftime('%s','now') AS INTEGER)*1000
 FROM selection_qa_turns WHERE status IN ('queued','running');
UPDATE selection_qa_turns SET status='failed',error_code='WORKER_UPGRADED',phase='terminal',last_sequence=last_sequence+1,
 lease_generation=lease_generation+1,lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,
 updated_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE status IN ('queued','running');
`;
