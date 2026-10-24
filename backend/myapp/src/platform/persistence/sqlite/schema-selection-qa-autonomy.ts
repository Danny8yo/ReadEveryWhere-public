/**
 * Migration 9 removes workflow-specific model counters without rebuilding the
 * parent turn table. Native column changes preserve retry/evidence/event FKs.
 * Fresh databases apply this same DDL after the immutable earlier migrations.
 */
export const SELECTION_QA_AUTONOMY_SCHEMA = `
ALTER TABLE selection_qa_turns ADD COLUMN model_call_total INTEGER NOT NULL DEFAULT 0 CHECK(typeof(model_call_total)='integer' AND model_call_total BETWEEN 0 AND 6);
UPDATE selection_qa_turns SET model_call_total=model_call_count+protocol_repair_call_count;
ALTER TABLE selection_qa_turns DROP COLUMN model_call_count;
ALTER TABLE selection_qa_turns DROP COLUMN protocol_repair_call_count;
ALTER TABLE selection_qa_turns RENAME COLUMN model_call_total TO model_call_count;
ALTER TABLE selection_qa_turns ADD COLUMN final_model_call_reserved INTEGER NOT NULL DEFAULT 0 CHECK(final_model_call_reserved IN (0,1));

INSERT INTO selection_qa_events(turn_id,user_id,sequence,kind,payload_json,created_at)
 SELECT id,user_id,last_sequence+1,'terminal',json_object('status','failed','reason','WORKER_UPGRADED','answer',answer),CAST(strftime('%s','now') AS INTEGER)*1000
 FROM selection_qa_turns WHERE status IN ('queued','running');
UPDATE selection_qa_turns
 SET status='failed',error_code='WORKER_UPGRADED',phase='terminal',last_sequence=last_sequence+1,
 lease_generation=lease_generation+1,lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,
 updated_at=CAST(strftime('%s','now') AS INTEGER)*1000
 WHERE status IN ('queued','running');
`;
