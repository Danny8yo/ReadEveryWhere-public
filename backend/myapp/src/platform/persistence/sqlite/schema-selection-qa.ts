export const SELECTION_QA_SCHEMA = `
CREATE TABLE selection_qa_conversations (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, book_id INTEGER NOT NULL,
 selection_json TEXT NOT NULL CHECK(json_valid(selection_json)),
 status TEXT NOT NULL CHECK(status IN ('active','frozen')), frozen_reason TEXT,
 first_question TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(id,user_id), FOREIGN KEY(book_id,user_id) REFERENCES books(id,user_id) ON DELETE CASCADE
);
CREATE INDEX selection_qa_conversations_page ON selection_qa_conversations(user_id,book_id,created_at DESC,id DESC);
CREATE TABLE selection_qa_turns (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, conversation_id TEXT NOT NULL,
 turn_number INTEGER NOT NULL CHECK(turn_number>0), question TEXT NOT NULL,
 answer TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK(status IN ('queued','running','completed','cancelled','failed','timed_out')),
 error_code TEXT, retry_of_turn_id TEXT, deadline INTEGER NOT NULL,
 lease_generation INTEGER NOT NULL DEFAULT 0 CHECK(lease_generation>=0), lease_token TEXT,
 model_snapshot_json TEXT CHECK(model_snapshot_json IS NULL OR json_valid(model_snapshot_json)),
 budget_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(budget_json)),
 last_sequence INTEGER NOT NULL DEFAULT 0 CHECK(last_sequence>=0),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(conversation_id,turn_number), UNIQUE(id,user_id), UNIQUE(id,conversation_id,user_id),
 FOREIGN KEY(conversation_id,user_id) REFERENCES selection_qa_conversations(id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(retry_of_turn_id,conversation_id,user_id) REFERENCES selection_qa_turns(id,conversation_id,user_id)
);
CREATE UNIQUE INDEX selection_qa_one_active_turn ON selection_qa_turns(conversation_id) WHERE status IN ('queued','running');
CREATE TABLE selection_qa_events (
 turn_id TEXT NOT NULL, user_id INTEGER NOT NULL, sequence INTEGER NOT NULL CHECK(sequence>0),
 kind TEXT NOT NULL CHECK(kind IN ('status','answer_delta','citation','terminal')),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at INTEGER NOT NULL,
 PRIMARY KEY(turn_id,sequence), FOREIGN KEY(turn_id,user_id) REFERENCES selection_qa_turns(id,user_id) ON DELETE CASCADE
);
CREATE TABLE selection_qa_evidence (
 turn_id TEXT NOT NULL,user_id INTEGER NOT NULL,evidence_id TEXT NOT NULL,
 source_kind TEXT NOT NULL CHECK(source_kind IN ('book','model_knowledge')),
 evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
 PRIMARY KEY(turn_id,evidence_id), FOREIGN KEY(turn_id,user_id) REFERENCES selection_qa_turns(id,user_id) ON DELETE CASCADE
);
CREATE TABLE selection_qa_commands (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, command_id TEXT NOT NULL,
 request_digest TEXT NOT NULL,result_json TEXT NOT NULL CHECK(json_valid(result_json)),created_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,command_id)
);
CREATE TABLE annotation_selection_commands (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,command_id TEXT NOT NULL,
 request_digest TEXT NOT NULL,result_json TEXT NOT NULL,created_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,command_id)
);
`;
