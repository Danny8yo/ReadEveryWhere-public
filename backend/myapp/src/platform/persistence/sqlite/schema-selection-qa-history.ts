/** Migration 8 removes the derived excerpt. Complete questions and answers remain in selection_qa_turns. */
export const SELECTION_QA_HISTORY_SCHEMA = `
ALTER TABLE selection_qa_conversations DROP COLUMN history_excerpt_json;
`;
