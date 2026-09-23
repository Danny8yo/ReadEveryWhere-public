/**
 * Immutable migration 6: persist the two protocol-repair calls separately.
 *
 * The original model_call_count remains bounded to four ordinary calls
 * (three planning calls plus the final stream). Repair calls have their own
 * bounded counter, so an upgrade preserves every existing turn without a
 * table rebuild or a weakened CHECK constraint.
 */
export const SELECTION_QA_REPAIR_BUDGET_SCHEMA = `
ALTER TABLE selection_qa_turns ADD COLUMN protocol_repair_call_count INTEGER NOT NULL DEFAULT 0 CHECK(protocol_repair_call_count BETWEEN 0 AND 2);
`;
