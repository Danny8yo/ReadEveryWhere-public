import assert from "node:assert/strict";
import test from "node:test";
import {
  authenticationIsFresh,
  isRegressionCasePassing,
  isResumableRegressionCase,
  matchesRequestedBook,
  regressionErrorCode,
  retryAfterMs,
  selectReferencedEvidence,
} from "./ai-reading-regression-lib.mjs";

test("matches the nested Reader Tools metadata title", () => {
  assert.equal(matchesRequestedBook({
    book: { bookId: 48, title: "棉花帝国：一部资本主义全球史" },
    contentRevision: { fileChecksum: "sha256:fixture" },
  }, "棉花帝国"), true);
  assert.equal(matchesRequestedBook({
    book: { bookId: 50, title: "百年孤独" },
  }, "棉花帝国"), false);
});

test("replays only evidence referenced by the final result", () => {
  const evidence = [
    { id: "intermediate", quote: "not cited" },
    { id: "cited-1", quote: "first citation" },
    { id: "cited-2", quote: "second citation" },
  ];

  assert.deepEqual(
    selectReferencedEvidence(evidence, ["cited-2", "cited-1"]),
    [evidence[2], evidence[1]],
  );
});

test("uses the root agent terminal reason for failed task diagnostics", () => {
  assert.equal(regressionErrorCode({
    agents: [
      { kind: "subagent", terminalReason: "CHILD_FAILED" },
      { kind: "root", terminalReason: "MODEL_CONTROL_TOOL_MIXED" },
    ],
  }, null), "MODEL_CONTROL_TOOL_MIXED");
});

test("accepts only completed results when citations replay", () => {
  assert.equal(isRegressionCasePassing({ finalStatus: "completed", citationValidity: { valid: true } }), true);
  assert.equal(isRegressionCasePassing({ finalStatus: "partial", citationValidity: { valid: true } }), false);
  assert.equal(isRegressionCasePassing({ finalStatus: "partial", citationValidity: { valid: false } }), false);
  assert.equal(isRegressionCasePassing({ finalStatus: "failed", citationValidity: { valid: true } }), false);
});

test("resumes an active checkpoint only when all V2 identifiers exist", () => {
  assert.equal(isResumableRegressionCase({
    finalStatus: "running",
    conversationId: "conversation-1",
    turnId: "turn-1",
    taskId: "task-1",
  }), true);
  assert.equal(isResumableRegressionCase({
    finalStatus: "running",
    conversationId: "conversation-1",
  }), false);
  assert.equal(isResumableRegressionCase({
    finalStatus: "completed",
    conversationId: "conversation-1",
    turnId: "turn-1",
    taskId: "task-1",
  }), false);
});

test("honors Retry-After and falls back to the auth throttle window", () => {
  assert.equal(retryAfterMs("123"), 123_000);
  assert.equal(retryAfterMs(null), 600_000);
  assert.equal(retryAfterMs("invalid"), 600_000);
});

test("reuses a JWT until the safe renewal window", () => {
  const authenticatedAt = Date.parse("2026-08-21T00:00:00.000Z");
  assert.equal(authenticationIsFresh(
    authenticatedAt,
    authenticatedAt + 2 * 60_000,
  ), true);
  assert.equal(authenticationIsFresh(
    authenticatedAt,
    authenticatedAt + 12 * 60_000,
  ), false);
});
