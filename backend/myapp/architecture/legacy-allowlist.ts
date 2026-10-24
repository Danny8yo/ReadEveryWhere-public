export const LEGACY_TOP_LEVEL_DIRECTORIES = new Set<string>([]);

export const LEGACY_ROOT_FILES = new Set<string>([]);

// Entries are exact rule|file:line|import keys emitted by dependency-rules.spec.ts.
export const LEGACY_DEPENDENCY_ALLOWLIST = new Set<string>([]);

// Entries are exact operation|table|file:line keys emitted by dependency-rules.spec.ts.
export const LEGACY_TABLE_ACCESS_ALLOWLIST = new Set<string>([
  "READ|selection_qa_turns|src/platform/persistence/sqlite/schema-selection-qa-autonomy.ts:6",
  "READ|selection_qa_turns|src/platform/persistence/sqlite/schema-selection-qa-quality.ts:2",
  "WRITE|selection_qa_events|src/platform/persistence/sqlite/schema-selection-qa-autonomy.ts:6",
  "WRITE|selection_qa_events|src/platform/persistence/sqlite/schema-selection-qa-quality.ts:2",
  "WRITE|selection_qa_turns|src/platform/persistence/sqlite/schema-selection-qa-autonomy.ts:6",
  "WRITE|selection_qa_turns|src/platform/persistence/sqlite/schema-selection-qa-quality.ts:2",
]);

// These accesses are explicit target-architecture exceptions documented in section 11.3.
export const APPROVED_TABLE_ACCESS = new Set([
  "READ|download_tasks|src/modules/intelligent-library/library-queries/infrastructure/sqlite-library-read-model.query.ts",
]);
